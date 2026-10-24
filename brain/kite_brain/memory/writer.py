"""The memory writer. Every write is a typed payload, and a favorite character only
reaches the ledger after the learning-fact check, which fails closed."""

import logging
import re
from dataclasses import dataclass
from datetime import datetime

from pydantic import BaseModel, ValidationError, constr

from kite_brain.config import LEARNING_FACT_THRESHOLD
from kite_brain.contract import (
    CharacterFact, CuriositySignal, Grade, InterestFact, LearningPayload, LearningStyle, Moment,
    ProfileFact, RouteName, StyleFact, Initiative,
)
from kite_brain.decide import DecideUnavailable
from kite_brain.deps import Deps, LlmRequest
from kite_brain.memory import ledger
from kite_brain.questions import learning_fact_questions

log = logging.getLogger(__name__)

WRITER_PROMPT = (
    "You read one exchange between a child and a learning companion and list what is worth remembering. "
    "Interests: only topics from this list, and only when the child shows real enthusiasm: {topics}. "
    "Characters: favorite fictional or public characters (from books, shows, games) the child names. "
    "Never list a real person or event from the child's life. "
    "Style: how the child says they like to learn, or null. Return empty lists when unsure."
)


class CharacterDraft(BaseModel):
    name: constr(max_length=40)


class Candidates(BaseModel):
    interests: list[str]
    characters: list[CharacterDraft]
    style: LearningStyle | None


@dataclass
class FinishedTurn:
    kid_id: str
    grade: Grade
    at: datetime
    session_id: str
    turn_id: str
    kid_text: str
    kite_text: str
    initiative: Initiative
    concept_id: str | None
    route: RouteName


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40]


def _key(payload: LearningPayload) -> tuple:
    """Deterministic identity for dedupe: same kind and value."""
    if isinstance(payload, InterestFact):
        return ("interest", payload.topic)
    if isinstance(payload, CharacterFact):
        return ("favorite_character", payload.name.casefold())
    if isinstance(payload, StyleFact):
        return ("learning_style", payload.style)
    return ("moment", payload.model_dump_json())


async def _approved_characters(turn: FinishedTurn, names: list[str], deps: Deps) -> list[str]:
    """Names that pass the learning-fact check. Nothing passes when the check could not
    run or when the fallback model answered it."""
    if not names:
        return []
    try:
        decisions = await deps.decide(turn.kid_text, learning_fact_questions(names))
    except DecideUnavailable:
        return []
    if decisions.backend == "haiku":
        return []
    return [
        n for i, n in enumerate(names)
        if decisions.answers[f"is_learning_fact:{i}"]["yes"] >= LEARNING_FACT_THRESHOLD
    ]


async def _candidates(turn: FinishedTurn, deps: Deps) -> Candidates:
    request = LlmRequest(
        system=WRITER_PROMPT.format(topics=", ".join(deps.catalog.topics)),
        context="",
        messages=[{"role": "user", "content": f"Child: {turn.kid_text}\nKite: {turn.kite_text}"}],
    )
    try:
        return await deps.llm.parse(request, Candidates)
    except Exception:  # a failed writer must not lose the curiosity signal already decided
        log.warning("memory writer parse failed", exc_info=True)
        return Candidates(interests=[], characters=[], style=None)


def _curiosity(turn: FinishedTurn, deps: Deps, prior: list[ledger.LedgerEvent]) -> list[tuple[CuriositySignal, str]]:
    """Signals with their topic. Assigned work and turns with no concept say nothing about curiosity."""
    if turn.concept_id is None or turn.initiative == "assigned_work":
        return []
    topic = deps.catalog.get(turn.concept_id).topic
    signals = [(CuriositySignal(signal=turn.initiative), topic)]
    earlier = any(e.topic == topic and e.session_id != turn.session_id for e in prior)
    revisited = any(
        isinstance(e.payload, CuriositySignal) and e.payload.signal == "return_visit"
        and e.topic == topic and e.session_id == turn.session_id
        for e in prior
    )
    if earlier and not revisited:
        signals.append((CuriositySignal(signal="return_visit"), topic))
    return signals


async def write_memory(turn: FinishedTurn, deps: Deps) -> list[str]:
    """Returns the payload kind of each event written, for the `memory.saved` event."""
    prior = ledger.events(deps.conn, deps.keys, turn.kid_id, 12)
    seen = {_key(e.payload) for e in prior}
    writes: list[tuple[LearningPayload, str | None]] = list(_curiosity(turn, deps, prior))

    found = await _candidates(turn, deps)
    facts: list[ProfileFact] = [
        InterestFact(topic=t) for t in found.interests if t in deps.catalog.topics
    ]
    if found.style:
        facts.append(StyleFact(style=found.style))
    approved = await _approved_characters(turn, [c.name for c in found.characters], deps)
    for name in approved:
        try:
            facts.append(CharacterFact(name=name, sprite=_slug(name)))
        except ValidationError:  # a name with no usable letters has no sprite slug
            continue
    for fact in facts:
        if _key(fact) not in seen:
            seen.add(_key(fact))
            writes.append((fact, None))

    moment_vector = None
    if turn.concept_id is not None:
        character = next((f.name for f in facts if isinstance(f, CharacterFact)), None)
        moment = Moment(
            concept_id=turn.concept_id, character=character,
            source="teach_back" if turn.route == "teach" else "answer",
        )
        if _key(moment) not in seen:
            text = moment.text(deps.catalog.get(turn.concept_id).kid_name)
            moment_vector = (await deps.embed([text]))[0]
            writes.append((moment, None))

    kinds = []
    for payload, topic in writes:
        event_id = ledger.append(
            deps.conn, deps.keys, deps.catalog, kid_id=turn.kid_id, grade=turn.grade, at=turn.at,
            session_id=turn.session_id, payload=payload, source_turn_id=turn.turn_id,
            concept_id=turn.concept_id if isinstance(payload, Moment) else None, topic=topic,
        )
        if isinstance(payload, Moment):
            deps.conn.execute(
                "INSERT INTO moment_vector(event_id, embedding) VALUES (?, ?)",
                (event_id, moment_vector.astype("float32").tobytes()),
            )
            deps.conn.commit()
        kinds.append(payload.kind)
    return kinds
