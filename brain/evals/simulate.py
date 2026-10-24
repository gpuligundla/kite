"""The childhood simulator (spec section 13, step 2): a Haiku persona plays Maya through
every grade, and each of her turns goes through run_turn like a real device's.

Grades run in order, not concurrently. A turn is only written when its grade equals the
kid's current grade, so the simulator sets the kid row's grade for the grade it plays
(and restores it at the end); two grades at once would fight over that one row. Order
also lets each grade recall the grades before it, which is the point of the exercise."""

import argparse
import asyncio
import logging
import math
import random
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta, timezone
from typing import Literal
from unittest.mock import patch

from pydantic import BaseModel
from ulid import ULID

from evals import TapBus, answer_of, routed_of
from kite_brain.catalog import Catalog, Concept
from kite_brain.contract import CuriositySignal
from kite_brain.deps import Deps, LlmRequest, ToolCall
from kite_brain.memory import ledger
from kite_brain.seed import KID_ID
from kite_brain.turn import pipeline
from kite_brain.turn.pipeline import TurnInput, run_turn

log = logging.getLogger(__name__)

PER_SESSION = 3  # turns in one sitting; sessions are spread over the school year
TURN_GAP = timedelta(minutes=5)
HISTORY_MESSAGES = 6
MAX_IDEAS = 6
MAX_TEACHABLE = 8

PERSONA_SYSTEM = (
    "You play Maya, a child talking to Kite, a friendly learning companion. Write only what Maya says next, "
    "in a real kid's voice for her grade: short, simple, a little messy, never an adult's.\n"
    "Pick one kind of move:\n"
    "- ask: a new question or comment, on your own.\n"
    "- follow_up: react to Kite's last answer, or ask why or how about it.\n"
    "- teach: explain a concept to Kite, as Kite asked you to. Set concept_id to one id from the teachable list.\n"
    "- movie: ask Kite to make a movie or game about something you like.\n"
    "When Kite's last answer ends by asking you to try a part again, answer it with a teach move on the same concept."
)

TRAITS = (
    "Maya's traits:\n"
    "- Dinosaurs are her biggest passion, about one move in three. From grade 4 on her dinosaur questions go "
    "deeper, into fossils and how paleontologists know things.\n"
    "- In grades 0 to 4 she often mentions Rexy, her stuffed T. rex, and soccer.\n"
    "- She teaches dinosaurs and light and color well: she covers every key point, correctly, in her own words.\n"
    "- In grades 3 to 5 she keeps mixing up area and perimeter: when she teaches them she leaves out one key "
    "point and states another one wrongly, and she is sure she is right.\n"
    "- She never mentions hurting herself."
)

# Sensitive questions come up about three times in all. Two are about death, because
# death is the only topic the seeded policy turns into a big-question card.
SENSITIVE = {
    3: "her goldfish died and she wonders why living things die",
    7: "her grandfather's funeral was this week and she has questions about dying",
    10: "the war she keeps hearing about in the news",
}
WELL_TOPICS = {"dinosaurs", "light"}
IDEA_TOPICS = ("dinosaurs", "light", "area_perimeter", "gravity", "water_cycle", "plants")

# Left to choose, the persona almost never teaches Kite back, and teach-backs are the only
# mastery evidence a turn can produce. So two sittings in three are a scheduled mini-lesson:
# ask about one focus concept, react to the answer, then teach it back.
LESSON_SKIP = 3  # every third sitting stays free for curiosity, movies and the sensitive question


def lesson_topics(grade: int) -> tuple[str, ...]:
    return ("area_perimeter", "dinosaurs", "light") if 3 <= grade <= 5 else ("dinosaurs", "light")


def lesson_for(catalog: Catalog, grade: int, sitting: int) -> Concept | None:
    """The focus concept for this sitting, or None for a free sitting. Topics rotate, and
    within a topic the newest concepts at or below her grade come first."""
    if sitting % LESSON_SKIP == LESSON_SKIP - 1:
        return None
    n = sitting - sitting // LESSON_SKIP
    topics = lesson_topics(grade)
    topic = topics[n % len(topics)]
    concepts = sorted((c for c in catalog.concepts if c.topic == topic and c.grade <= grade),
                      key=lambda c: (-c.grade, c.id))
    return concepts[(n // len(topics)) % len(concepts)] if concepts else None


def planned_kind(position: int) -> Literal["ask", "teach"] | None:
    """In a lesson sitting: ask first, react freely, then teach back."""
    return {0: "ask", PER_SESSION - 1: "teach"}.get(position)


class PersonaMove(BaseModel):
    kind: Literal["ask", "follow_up", "teach", "movie"]
    text: str
    concept_id: str | None = None


@dataclass
class SimReport:
    turns: int = 0
    by_grade: dict[int, int] = field(default_factory=dict)
    teach_turns: int = 0


class NoTts:
    async def speak(self, text, spec) -> bytes:
        return b""


class _GradeClock:
    """This grade's own clock, set to each turn's time before the turn runs."""

    def __init__(self, now: datetime):
        self.now = now

    def __call__(self) -> datetime:
        return self.now


def _skill(concept: Concept, grade: int) -> str:
    return (
        "explains well" if concept.topic in WELL_TOPICS
        else "mixes this up" if concept.topic == "area_perimeter" and 3 <= grade <= 5
        else "explains so-so"
    )


def traits_for(
    catalog: Catalog, grade: int, turn: int, turns: int, met: list[str], lesson: Concept | None = None
) -> str:
    """Maya's traits plus what is true of this one turn: ideas to ask about, concepts she
    has met and could teach, and a sensitive question when one is due."""
    rng = random.Random(grade * 1000 + turn)
    pool = [c for c in catalog.concepts if c.grade <= grade]
    ideas = [c for c in pool if c.topic in IDEA_TOPICS] or pool
    lines = [TRAITS, f"Maya is in grade {grade}.", "Ideas she could ask about: "
             + "; ".join(c.kid_name for c in rng.sample(ideas, min(MAX_IDEAS, len(ideas))))]
    teachable = [catalog.get(c) for c in met[-MAX_TEACHABLE:]]
    if teachable:
        lines.append("Teachable concepts, with the key points a good explanation covers:")
        for c in teachable:
            lines.append(f"- {c.id}: {c.kid_name} (Maya {_skill(c, grade)}). Key points: {' | '.join(c.key_points)}")
    if grade in SENSITIVE and turn == turns // 2:
        lines.append(f"This turn, make an ask move about this, as a kid would: {SENSITIVE[grade]}.")
    elif lesson and (kind := planned_kind(turn % PER_SESSION)) == "ask":
        lines.append(f"This turn, make an ask move: a question about {lesson.kid_name}.")
    elif lesson and kind == "teach":
        lines.append(
            f"This turn, make a teach move with concept_id {lesson.id}: explain {lesson.kid_name} to Kite in "
            f"your own words, like a kid. Maya {_skill(lesson, grade)}. "
            f"Key points a good explanation covers: {' | '.join(lesson.key_points)}"
        )
    return "\n".join(lines)


async def next_move(llm, grade: int, traits: str, history: list[tuple[str, str]]) -> PersonaMove:
    """Haiku's next move for Maya. `history` is (role, text) pairs, oldest first, ending with
    Kite's last answer."""
    transcript = "\n".join(f"{role}: {text}" for role, text in history[-HISTORY_MESSAGES:])
    request = LlmRequest(
        system=PERSONA_SYSTEM,
        context=traits,
        messages=[{"role": "user", "content": (
            f"The conversation so far:\n{transcript or '(nothing yet, you are starting a sitting)'}\n\n"
            f"What does Maya, in grade {grade}, say or do next?"
        )}],
    )
    return await llm.parse(request, PersonaMove)


def turn_times(grade: int, start_year: int, turns: int, until: datetime) -> list[datetime]:
    """Sittings of PER_SESSION turns spread over this grade's school year, which starts
    Sep 8 and is cut at Jun 1 or at `until`, whichever is earlier."""
    start = datetime(start_year + grade, 9, 8, 15, 0, tzinfo=timezone.utc)
    end = min(datetime(start_year + grade + 1, 6, 1, tzinfo=timezone.utc), until)
    if end <= start + PER_SESSION * TURN_GAP:
        raise ValueError(f"grade {grade} has no school days before {until:%Y-%m-%d}")
    sittings = math.ceil(turns / PER_SESSION)
    gap = (end - start - PER_SESSION * TURN_GAP) / sittings
    return [start + gap * (i // PER_SESSION) + TURN_GAP * (i % PER_SESSION) for i in range(turns)]


def _topic_of(call: ToolCall, topics: list[str]) -> str | None:
    """The catalog topic a movie or game call is about, when it names one."""
    said = call.topic.lower().replace(" ", "_")
    return next((t for t in topics if t in said or said in t), None)


def _met(deps: Deps, grade: int) -> list[str]:
    """Concepts she has met at or below `grade`, oldest first."""
    evts = ledger.events(deps.conn, deps.keys, KID_ID, grade)
    return list(dict.fromkeys(e.concept_id for e in evts if e.concept_id))


def _inputs(move: PersonaMove, met: list[str], grade: int, at: datetime, lesson: Concept | None = None) -> TurnInput:
    base = dict(kid_id=KID_ID, device="os", text=move.text, as_of_grade=grade, now=at)
    if move.kind == "teach" and lesson:
        return TurnInput(**base, mode="teach", concept_id=lesson.id)
    if move.kind == "teach" and met:
        # An unknown or missing concept id means her most recent one.
        concept = move.concept_id if move.concept_id in met else met[-1]
        return TurnInput(**base, mode="teach", concept_id=concept)
    return TurnInput(**base, mode="talk")


async def _play_grade(
    base: Deps, grade: int, turns: int, start_year: int, until: datetime, report: SimReport,
    creations: list[ToolCall],
) -> None:
    times = turn_times(grade, start_year, turns, until)
    clock, tap = _GradeClock(times[0]), TapBus()
    deps = replace(base, clock=clock, bus=tap, tts=NoTts())
    history: list[tuple[str, str]] = []
    for i, at in enumerate(times):
        clock.now = at
        met = _met(deps, grade)
        lesson = None if grade in SENSITIVE and i == turns // 2 else lesson_for(deps.catalog, grade, i // PER_SESSION)
        try:
            move = await next_move(deps.llm, grade, traits_for(deps.catalog, grade, i, turns, met, lesson), history)
            if lesson and planned_kind(i % PER_SESSION) == "teach" and move.kind != "teach":
                # A question written where an explanation was asked for grades as all-missing; ask once more.
                move = await next_move(deps.llm, grade, traits_for(deps.catalog, grade, i, turns, met, lesson), history)
        except Exception as e:  # one bad persona call must not end a 45-minute night
            log.warning("grade %d turn %d: persona failed (%s)", grade, i, type(e).__name__)
            idea = random.Random(grade * 1000 + i).choice([c for c in deps.catalog.concepts if c.grade <= grade])
            move = PersonaMove(kind="ask", text=f"Can you tell me about {idea.kid_name}?")
        if lesson and planned_kind(i % PER_SESSION) == "teach" and move.kind != "teach":
            move = move.model_copy(update={"kind": "follow_up"})  # still no explanation: don't grade a question
        elif lesson and (kind := planned_kind(i % PER_SESSION)):
            move = move.model_copy(update={"kind": kind})
        elif lesson and move.kind == "teach":  # an unscheduled teach-back before Kite explains scores all-missing
            move = move.model_copy(update={"kind": "follow_up"})
        inp, turn_id = _inputs(move, met, grade, at, lesson if move.kind == "teach" else None), str(ULID())
        await run_turn(inp, deps, turn_id)
        events = tap.take()
        for call in creations:
            if topic := _topic_of(call, deps.catalog.topics):
                ledger.append(
                    deps.conn, deps.keys, deps.catalog, kid_id=KID_ID, grade=grade, at=at,
                    session_id=ledger.session_for(deps.conn, KID_ID, at), payload=CuriositySignal(signal="chose_creation"),
                    source_turn_id=turn_id, topic=topic,
                )
        creations.clear()
        answer = answer_of(events)
        history += [("Maya", move.text), ("Kite", answer)]
        report.turns += 1
        report.by_grade[grade] = report.by_grade.get(grade, 0) + 1
        report.teach_turns += inp.mode == "teach"
        routed = routed_of(events)
        log.info("grade %d turn %d: %s %s", grade, i, move.kind, routed.route if routed else "error")


async def simulate(
    make_deps: Callable[[], Deps], grades: list[int], turns_per_grade: int, start_year: int = 2015
) -> SimReport:
    """Play Maya through `grades` in order. Her turns are stamped inside each grade's school
    year and never later than the real now, so a live turn is always the newest."""
    base = make_deps()
    until = base.clock() - timedelta(hours=1)
    original = base.conn.execute("SELECT grade FROM kid WHERE id = ?", (KID_ID,)).fetchone()["grade"]
    report, creations = SimReport(), []
    try:
        # Task 13 replaces the real tool-call hook; here a movie or game is only a curiosity signal.
        with patch.object(pipeline, "act_on_tool_call", lambda call, *_, **__: creations.append(call)):
            for grade in sorted(grades):
                base.conn.execute("UPDATE kid SET grade = ? WHERE id = ?", (grade, KID_ID))
                base.conn.commit()
                await _play_grade(base, grade, turns_per_grade, start_year, until, report, creations)
    finally:
        base.conn.execute("UPDATE kid SET grade = ? WHERE id = ?", (original, KID_ID))
        base.conn.commit()
    return report


def parse_grades(text: str) -> list[int]:
    """`1-11` or `3,4`."""
    if "-" in text:
        low, high = text.split("-")
        return list(range(int(low), int(high) + 1))
    return [int(g) for g in text.split(",")]


def main() -> None:
    from kite_brain.api import build_deps
    from kite_brain.config import get_settings
    from kite_brain.db import connect, init_db

    parser = argparse.ArgumentParser(description="Play Maya's childhood through the real pipeline.")
    parser.add_argument("--grades", default="1-11", help="e.g. 1-11 or 3,4")
    parser.add_argument("--turns", type=int, default=30, help="turns per grade")
    parser.add_argument("--start-year", type=int, default=2015, help="the school year Maya was in K")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    settings = get_settings()
    conn = connect(settings.KITE_DB_PATH)
    init_db(conn)
    report = asyncio.run(simulate(
        lambda: build_deps(conn, TapBus(), settings), parse_grades(args.grades), args.turns, args.start_year
    ))
    print(f"simulated {report.turns} turns ({report.teach_turns} teach) by grade {report.by_grade}")


if __name__ == "__main__":
    main()
