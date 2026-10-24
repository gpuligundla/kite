"""One turn, in the seven steps of spec section 4. Routing is route()'s job; this
module only orchestrates, and no log line here ever carries conversation text."""

import asyncio
import logging
import re
import time
from collections.abc import Awaitable
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import TypeVar, get_args

import numpy as np
from ulid import ULID

from kite_brain.config import (
    ABOUT_KITE_THRESHOLD, DECIDE_TOTAL_TIMEOUT_S, RECALL_TIMEOUT_S, SAFETY_TIMEOUT_S,
)
from kite_brain.contract import (
    AlertEvent, AnswerDoneEvent, AnswerSentenceEvent, CardEvent, ConceptEvidence, DecidedEvent, DeviceKind,
    HeardEvent, MemorySavedEvent, Mode, PayloadKind, PolicyAction, RecalledEvent, RoutedEvent, SensitiveTopic,
    TaughtEvent,
)
from kite_brain.crypto import aad, seal
from kite_brain.decide import Decisions, top
from kite_brain.deps import Deps, LlmRequest, ToolCall
from kite_brain.homework import NO_HOMEWORK, homework_signal
from kite_brain.llm import LlmRefused
from kite_brain.memory import ledger
from kite_brain.memory.embed import top_k
from kite_brain.memory.recall import Recall, recall
from kite_brain.memory.writer import FinishedTurn, write_memory
from kite_brain.policy import (
    HOMEWORK_LINES, about_me_context, band_for, collab_log, fk_grade, system_prompt, turn_context,
)
from kite_brain.questions import (
    ABOUT_KITE, ABOUT_ME, FORGET_REQUEST, INITIATIVE, SAFETY, SENSITIVE_TOPIC, concept_question, teach_point_questions,
)
from kite_brain.studio.game import start_game
from kite_brain.studio.movie import start_movie
from kite_brain.studio.store import spawn
from kite_brain.turn.route import FALLBACK, RoutePlan, route, teach_start_line
from kite_brain.turn.speak import END, SentenceSplitter, audio_b64, drain, speak_sentences
from kite_brain.turn.teach import TeachGrade, earlier_attempts, grade_teach, merge_attempts, teach_feedback_context
from kite_brain.voice import Situation, VoiceSpec, voice_for

log = logging.getLogger(__name__)

CONCEPT_CANDIDATES = 6
EXCERPT_ROWS = 4  # the 2 turns (kid and kite) before the flagged message
T = TypeVar("T")


@dataclass(frozen=True)
class TurnInput:
    kid_id: str
    device: DeviceKind
    mode: Mode
    text: str | None = None
    audio: bytes | None = None
    audio_mime: str | None = None
    image: bytes | None = None
    as_of_grade: int | None = None
    concept_id: str | None = None
    now: datetime | None = None


class _Turn:
    """What every step shares. Events are published through `emit`, which stamps the
    kid, turn and time; `emit_kid` also sends the grown-up copy once the route is known."""

    def __init__(self, inp: TurnInput, deps: Deps, turn_id: str):
        self.inp, self.deps, self.turn_id = inp, deps, turn_id
        self.now = inp.now or deps.clock()
        self.read_only = False
        self.plan: RoutePlan | None = None
        self.teach: TeachGrade | None = None
        self.about_kite = 0.0

    def load_kid(self) -> None:
        row = self.deps.conn.execute(
            "SELECT display_name, grade, family_id FROM kid WHERE id = ?", (self.inp.kid_id,)
        ).fetchone()
        self.kid_name, self.family_id = row["display_name"], row["family_id"]
        self.grade = row["grade"] if self.inp.as_of_grade is None else self.inp.as_of_grade
        self.read_only = self.grade < row["grade"]
        self.band = band_for(self.grade)

    def emit(self, cls, audience, **fields):
        return self.deps.bus.publish(cls(
            kid_id=self.inp.kid_id, turn_id=self.turn_id, at=self.deps.clock(), audience=audience, **fields
        ))

    def emit_kid(self, cls, **fields) -> None:
        self.emit(cls, "kid", **fields)
        if self.plan:
            self.emit(cls, self.plan.audience, **fields)

    def policy(self) -> dict[str, PolicyAction]:
        rows = self.deps.conn.execute(
            "SELECT topic, action FROM policy WHERE family_id = ?", (self.family_id,)
        ).fetchall()
        return {t: "answer" for t in get_args(SensitiveTopic)} | {r["topic"]: r["action"] for r in rows}


async def _timed(turn: _Turn, name: str, aw: Awaitable[T], timeout_s: float) -> T | None:
    """A step's result, or None when it failed or timed out. The log carries the step name only."""
    try:
        return await asyncio.wait_for(aw, timeout_s)
    except Exception as e:
        log.warning("turn %s: %s failed (%s)", turn.turn_id, name, type(e).__name__)
        return None


async def _hear(turn: _Turn) -> str:
    inp = turn.inp
    if inp.text is not None:
        text = inp.text
    else:
        try:
            text = await turn.deps.stt.transcribe(inp.audio or b"", inp.audio_mime or "audio/webm")
        except Exception as e:
            log.warning("turn %s: stt failed (%s)", turn.turn_id, type(e).__name__)
            text = ""
    return re.sub(r"\s+", " ", text).strip()


def _candidates(turn: _Turn, vec: np.ndarray | None) -> list[str]:
    catalog = turn.deps.catalog
    if vec is None or catalog.vectors is None:
        return []
    return [catalog.concepts[i].id for i, _ in top_k(vec, catalog.vectors, CONCEPT_CANDIDATES)]


async def _decide(turn: _Turn, text: str, candidates: list[str]) -> Decisions | None:
    questions = [SAFETY, SENSITIVE_TOPIC, INITIATIVE, ABOUT_ME, ABOUT_KITE, FORGET_REQUEST]
    if candidates:
        questions.append(concept_question(candidates, {c: turn.deps.catalog.get(c).name for c in candidates}))
    if turn.inp.mode == "teach" and turn.inp.concept_id:
        questions += teach_point_questions(turn.deps.catalog.get(turn.inp.concept_id))
    return await _timed(turn, "decide", turn.deps.decide(text, questions), DECIDE_TOTAL_TIMEOUT_S)


def _concept(decisions: Decisions | None) -> str | None:
    probs = decisions.answers.get("concept") if decisions else None
    chosen = top(probs) if probs else "none"
    return None if chosen == "none" else chosen


def _excerpt(recalled: Recall | None, text: str) -> str:
    history = recalled.history[-EXCERPT_ROWS:] if recalled else []
    return "\n".join([*(f"{role}: {t}" for role, t in history), f"kid: {text}"])


def _voice(band, situation: Situation) -> VoiceSpec | None:
    try:
        return voice_for(band, situation)
    except ValueError:  # KITE_VOICES not configured: text only
        return None


def act_on_tool_call(call: ToolCall, turn_id: str, turn: _Turn | None = None) -> None:
    """Start the movie or game Claude asked for. It runs in the background and reaches the kid
    as creation events. A time-travel turn still gets its creation but records no evidence."""
    log.info("turn %s: tool call %s", turn_id, call.name)
    if turn is None:
        return
    start = start_movie if call.name == "make_movie" else start_game
    spawn(start(turn.deps, turn.inp.kid_id, call.topic, call.learning_goal, turn.grade, read_only=turn.read_only))


async def _answer(turn: _Turn, text: str, recalled: Recall, spec: VoiceSpec | None, publish) -> str:
    """Stream Claude into sentences while the speaker task voices them in order."""
    plan, deps = turn.plan, turn.deps
    if plan.route == "about_me":
        context = about_me_context(turn.kid_name, turn.grade, recalled.kid_view)
    elif turn.teach:
        context = teach_feedback_context(
            turn.kid_name, turn.grade, deps.catalog.get(turn.inp.concept_id), turn.teach, text
        )
        text = "Please respond to what I just taught you."
    else:
        context = turn_context(
            turn.kid_name, turn.grade, recalled.kid_view, " ".join(recalled.guidance) or None,
            recalled.depth_topic, recalled.history, HOMEWORK_LINES.get(plan.homework_mode, ""),
            build_log=collab_log() if turn.about_kite >= ABOUT_KITE_THRESHOLD else None,
        )
    request = LlmRequest(
        system=system_prompt(turn.band, values=""), context=context,
        messages=[{"role": "user", "content": text}], image=turn.inp.image, tools=not turn.teach,
    )
    queue: asyncio.Queue = asyncio.Queue()
    speaker = asyncio.create_task(speak_sentences(drain(queue), deps, spec, publish))
    splitter, stream = SentenceSplitter(), deps.llm.stream(request)
    try:
        async for item in stream:
            if speaker.done():  # a flagged sentence ended the answer
                break
            if isinstance(item, ToolCall):
                act_on_tool_call(item, turn.turn_id, turn)
            else:
                for sentence in splitter.feed(item):
                    queue.put_nowait(sentence)
        for sentence in splitter.flush():
            queue.put_nowait(sentence)
    except LlmRefused:
        log.info("turn %s: answer refused", turn.turn_id)
        queue.put_nowait(FALLBACK)
    except Exception as e:
        log.warning("turn %s: answer failed (%s)", turn.turn_id, type(e).__name__)
        queue.put_nowait(FALLBACK)
    finally:
        await stream.aclose()
    queue.put_nowait(END)
    return await speaker


async def _one(text: str):
    yield text


def _write_session_turns(turn: _Turn, session_id: str, kid_text: str, kite_text: str) -> None:
    key = turn.deps.keys.for_kid(turn.inp.kid_id)
    expires = ledger.iso(datetime.now(timezone.utc) + ledger.SESSION_TURN_TTL)
    for row_id, role, text in ((turn.turn_id, "kid", kid_text), (f"{turn.turn_id}-kite", "kite", kite_text)):
        turn.deps.conn.execute(
            "INSERT INTO session_turn(id, kid_id, session_id, device, role, at, expires_at, text)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (row_id, turn.inp.kid_id, session_id, turn.inp.device, role, ledger.iso(turn.now), expires,
             seal(key, text.encode(), aad("session_turn", turn.inp.kid_id, row_id))),
        )
    turn.deps.conn.commit()


def _grade_teach(turn: _Turn, decisions: Decisions, concept_id: str) -> TeachGrade:
    """This attempt's verdicts merged with the session's earlier attempts at the concept."""
    deps = turn.deps
    session_id = ledger.session_for(deps.conn, turn.inp.kid_id, turn.now)
    earlier = earlier_attempts(
        ledger.events(deps.conn, deps.keys, turn.inp.kid_id, turn.grade), concept_id, session_id
    )
    return merge_attempts(earlier, grade_teach(decisions, deps.catalog.get(concept_id)))


def _record_teach(turn: _Turn, session_id: str, concept_id: str) -> PayloadKind:
    """The teach-back evidence, and the grown-up's `taught` event. The moment comes from write_memory."""
    grade = turn.teach
    deps = turn.deps
    evidence = ConceptEvidence(outcome=grade.outcome, source="teach_back", points=grade.verdicts)
    ledger.append(
        deps.conn, deps.keys, deps.catalog, kid_id=turn.inp.kid_id, grade=turn.grade, at=turn.now,
        session_id=session_id, payload=evidence, source_turn_id=turn.turn_id, concept_id=concept_id,
    )
    turn.emit(TaughtEvent, "parent", concept_id=concept_id, points=grade.verdicts, outcome=grade.outcome)
    return evidence.kind


def _forget_previous(turn: _Turn) -> None:
    """The kid's latest stored turn, the one recall's history ends with."""
    row = turn.deps.conn.execute(
        "SELECT id FROM session_turn WHERE kid_id = ? AND role = 'kid' ORDER BY at DESC, id DESC LIMIT 1",
        (turn.inp.kid_id,),
    ).fetchone()
    if row:
        ledger.forget_turn(turn.deps.conn, turn.inp.kid_id, row["id"])


def _write_card(turn: _Turn, answer: str) -> str:
    plan, kid_id = turn.plan, turn.inp.kid_id
    card_id = str(ULID())
    key, a = turn.deps.keys.for_kid(kid_id), aad("big_question_card", kid_id, card_id)
    summary = "Kite asked them to bring this one to you." if plan.route == "ask_parent" else answer[:300]
    starter = f"Ask what they wondered about {plan.card_topic} today."
    turn.deps.conn.execute(
        "INSERT INTO big_question_card(id, kid_id, grade, at, topic, source_turn_id, summary, starter)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (card_id, kid_id, turn.grade, ledger.iso(turn.now), plan.card_topic, turn.turn_id,
         seal(key, summary.encode(), a), seal(key, starter.encode(), a)),
    )
    turn.deps.conn.commit()
    return card_id


async def run_turn(inp: TurnInput, deps: Deps, turn_id: str) -> None:
    started = time.monotonic()
    turn = _Turn(inp, deps, turn_id)
    try:
        await _run(turn)
    except Exception as e:  # no traceback: a vendor error body can echo the kid's words
        log.error("turn %s failed (%s)", turn_id, type(e).__name__)
        turn.emit_kid(AnswerSentenceEvent, index=0, text=FALLBACK, audio_b64="")
        turn.emit_kid(AnswerDoneEvent, text=FALLBACK, fk_grade=None, depth_override=False, route="fallback")
    log.info("turn %s: route=%s read_only=%s ms=%d", turn_id,
             turn.plan.route if turn.plan else "error", turn.read_only, (time.monotonic() - started) * 1000)


async def _run(turn: _Turn) -> None:
    inp, deps = turn.inp, turn.deps
    turn.load_kid()

    # 1. Heard
    text = await _hear(turn)
    turn.emit(HeardEvent, "kid", text=text)

    # 2 and 3. Embed once, then decide and input safety together, then recall.
    decisions = safety = recalled = vec = None
    homework = NO_HOMEWORK
    concept_id, about_me = inp.concept_id, 0.0
    if text:
        vec = await _timed(turn, "embed", deps.embed([text]), SAFETY_TIMEOUT_S)
        vec = vec[0] if vec is not None else None
        decisions, safety = await asyncio.gather(
            _decide(turn, text, _candidates(turn, vec)),
            _timed(turn, "safety", deps.safety.check_input(text), SAFETY_TIMEOUT_S),
        )
        concept_id = inp.concept_id or _concept(decisions)
        about_me = decisions.answers["about_me"]["yes"] if decisions else 0.0
        if decisions:
            turn.about_kite = decisions.answers.get("about_kite", {}).get("yes", 0.0)
        recalled = await _timed(
            turn, "recall", recall(deps, inp.kid_id, turn.grade, vec, concept_id, about_me), RECALL_TIMEOUT_S
        )
        if decisions:
            # The real clock, not turn.now, which a simulation can set: the class was resolved at app start.
            homework = await homework_signal(
                deps, inp.kid_id, vec, concept_id, decisions.answers["initiative"]["assigned_work"], deps.clock()
            )

    # 4. Route
    plan = turn.plan = route(
        decisions, safety, turn.policy(), homework, inp.mode, not text, recall_ok=recalled is not None
    )

    if plan.route == "teach":
        turn.teach = _grade_teach(turn, decisions, concept_id)
    if plan.forget and not turn.read_only:  # a time-travel turn deletes nothing, as it writes nothing
        _forget_previous(turn)

    # 5. Grown-up events, to the audience the plan chose
    turn.emit(HeardEvent, plan.audience, text=text)
    if decisions:
        a = decisions.answers
        turn.emit(DecidedEvent, plan.audience, backend=decisions.backend, safety=a["safety"],
                  sensitive_topic=top(a["sensitive_topic"]), initiative=top(a["initiative"]),
                  concept_id=concept_id, about_me=about_me)
    if recalled:
        turn.emit(RecalledEvent, plan.audience, moments=recalled.kid_view.moments,
                  strength_topics=recalled.strength, guidance_used=bool(recalled.guidance))
    turn.emit(RoutedEvent, plan.audience, route=plan.route, alert_kinds=plan.alert_kinds, action=plan.action,
              homework_mode=plan.homework_mode, assignment_title=plan.assignment_title)
    if plan.alert_to:
        alert_id = ledger.record_alert(
            deps.conn, deps.keys, kid_id=inp.kid_id, kinds=plan.alert_kinds, routed_to=plan.alert_to,
            excerpt=_excerpt(recalled, text), at=turn.now,
        )
        turn.emit(AlertEvent, plan.alert_to, alert_id=alert_id, kinds=plan.alert_kinds, routed_to=plan.alert_to)

    # 6. Answer
    situation = plan.situation
    if turn.teach:
        situation = "celebrate" if turn.teach.all_covered else "answer"
    spec = _voice(turn.band, situation)
    publish = lambda i, t, audio: turn.emit_kid(AnswerSentenceEvent, index=i, text=t, audio_b64=audio)  # noqa: E731
    if plan.reply:
        answer = await speak_sentences(_one(plan.reply), deps, spec, publish, moderate=False)
    elif plan.call_llm:
        answer = await _answer(turn, text, recalled, spec, publish)
    else:
        answer = ""
    depth = bool(recalled and recalled.depth_topic) and plan.call_llm
    turn.emit_kid(AnswerDoneEvent, text=answer, fk_grade=fk_grade(answer) if answer else None,
                  depth_override=depth, route=plan.route)
    if plan.card_topic and not turn.read_only:
        turn.emit(CardEvent, plan.audience, card_id=_write_card(turn, answer), topic=plan.card_topic)

    # 7. Persist. A time-travel turn wrote its alert above and nothing else.
    if turn.read_only or not plan.write_memory:
        return
    session_id = ledger.session_for(deps.conn, inp.kid_id, turn.now)
    _write_session_turns(turn, session_id, text, answer)
    saved: list[PayloadKind] = []
    if turn.teach:
        saved.append(_record_teach(turn, session_id, concept_id))
    finished = FinishedTurn(
        kid_id=inp.kid_id, grade=turn.grade, at=turn.now, session_id=session_id, turn_id=turn.turn_id,
        kid_text=text, kite_text=answer, initiative=top(decisions.answers["initiative"]),
        concept_id=concept_id, route=plan.route,
    )
    kinds = saved + await write_memory(finished, deps)
    turn.emit(MemorySavedEvent, plan.audience, count=len(kinds), kinds=kinds)


async def start_teach(deps: Deps, kid_id: str, concept_id: str) -> None:
    """Kite's fixed opening for Teach Kite, spoken in the listen voice to the kid, with the grown-up's copy."""
    grade = deps.conn.execute("SELECT grade FROM kid WHERE id = ?", (kid_id,)).fetchone()["grade"]
    text = teach_start_line(deps.catalog.get(concept_id).kid_name)
    audio = await audio_b64(deps, text, _voice(band_for(grade), "listen"))
    for audience in ("kid", "parent"):
        deps.bus.publish(AnswerSentenceEvent(
            kid_id=kid_id, turn_id=None, at=deps.clock(), audience=audience, index=0, text=text, audio_b64=audio
        ))
