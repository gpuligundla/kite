"""The homework guard on a simulated Canvas-shaped class (spec section 10).

`assignments.json` holds the class. At app start `load_assignments` resolves its
offsets against the clock and `store_assignments` upserts the result, so the live quiz
is live at every restart. Each turn then asks `homework_signal` what to do."""

import asyncio
import json
import logging
import re
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Literal

import numpy as np

from kite_brain.config import ASSIGNED_WORK_THRESHOLD, MATCH_COSINE, NEAR_QUIZ_COSINE
from kite_brain.crypto import FamilyKeys, aad, open_sealed, seal
from kite_brain.deps import Deps
from kite_brain.memory.ledger import iso
from kite_brain.turn.route import HomeworkSignal

log = logging.getLogger(__name__)

ASSIGNMENTS_PATH = Path(__file__).with_name("assignments.json")
EMBED_TIMEOUT_S = 15.0  # at startup, so a slow embedding service cannot hold the server back
NO_HOMEWORK = HomeworkSignal(status=None, title=None, near_live_quiz=False)
_NUMBERED = re.compile(r"^\s*\d+[.)]\s*(.+?)\s*$", re.M)


@dataclass(frozen=True)
class Assignment:
    id: str
    title: str
    kind: Literal["homework", "quiz"]
    unlock_at: datetime | None
    due_at: datetime | None
    lock_at: datetime | None
    items: tuple[str, ...]  # the numbered questions of the description
    concept_id: str
    topic: str
    description: str


def load_assignments(kid_id: str, now: datetime) -> list[Assignment]:
    """The kid's class, with each `*_offset_hours` resolved against `now`. A real LMS
    connector (Canvas, Google Classroom) replaces only this function: everything after it
    works on `Assignment`."""

    def at(raw: dict, field: str) -> datetime | None:
        hours = raw[f"{field}_offset_hours"]
        return None if hours is None else now + timedelta(hours=hours)

    return [
        Assignment(
            id=f"{kid_id}-{raw['id']}", title=raw["name"], kind="quiz" if raw["is_quiz_assignment"] else "homework",
            unlock_at=at(raw, "unlock_at"), due_at=at(raw, "due_at"), lock_at=at(raw, "lock_at"),
            items=tuple(_NUMBERED.findall(raw["description"])), concept_id=raw["concept_id"], topic=raw["topic"],
            description=raw["description"],
        )
        for raw in json.loads(ASSIGNMENTS_PATH.read_text())
    ]


def status(a: Assignment, now: datetime) -> Literal["exam_live", "open", "closed"]:
    """exam_live: a quiz that is unlocked and neither locked nor due. open: homework that
    is not locked yet. closed: everything else."""
    unlocked = a.unlock_at is None or a.unlock_at <= now
    locked = a.lock_at is not None and a.lock_at <= now
    due = a.due_at is not None and a.due_at <= now
    if a.kind == "quiz" and unlocked and not locked and not due:
        return "exam_live"
    return "open" if a.kind == "homework" and not locked else "closed"


def stored_assignments(
    conn: sqlite3.Connection, keys: FamilyKeys, kid_id: str
) -> list[tuple[Assignment, np.ndarray]]:
    """Each stored assignment with one embedding row per item (no rows when the items
    could not be embedded)."""
    key, out = keys.for_kid(kid_id), []
    for r in conn.execute("SELECT * FROM assignment WHERE kid_id = ? ORDER BY id", (kid_id,)).fetchall():
        items = conn.execute(
            "SELECT id, text, embedding FROM assignment_item WHERE assignment_id = ? ORDER BY position", (r["id"],)
        ).fetchall()
        when = lambda col: datetime.fromisoformat(r[col]) if r[col] else None  # noqa: E731
        assignment = Assignment(
            id=r["id"], title=r["title"], kind="quiz" if r["is_quiz"] else "homework",
            unlock_at=when("unlock_at"), due_at=when("due_at"), lock_at=when("lock_at"),
            items=tuple(open_sealed(key, i["text"], aad("assignment_item", kid_id, i["id"])).decode() for i in items),
            concept_id=r["concept_id"], topic=r["topic"],
            description=open_sealed(key, r["description"], aad("assignment", kid_id, r["id"])).decode(),
        )
        matrix = np.array([np.frombuffer(i["embedding"], dtype=np.float32) for i in items])
        out.append((assignment, matrix))
    return out


async def store_assignments(deps: Deps, kid_id: str, items: list[Assignment]) -> None:
    """Upsert by id, so a restart never duplicates. Dates are always refreshed. Items are
    re-embedded only when their text changed; if embedding fails the assignment is stored
    with no items and the guard falls back to concept, topic and assigned-work signals."""
    conn, key = deps.conn, deps.keys.for_kid(kid_id)
    stored = {a.id: a for a, _ in stored_assignments(conn, deps.keys, kid_id)}
    changed = [a for a in items if a.id not in stored or stored[a.id].items != a.items]
    embedded = None
    if changed:
        try:
            embedded = iter(await asyncio.wait_for(
                deps.embed([text for a in changed for text in a.items]), EMBED_TIMEOUT_S
            ))
        except Exception as e:
            log.warning("assignment embedding failed (%s)", type(e).__name__)
    for a in items:
        conn.execute(
            "INSERT INTO assignment(id, kid_id, title, description, is_quiz, unlock_at, due_at, lock_at, concept_id, topic)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title,"
            " description = excluded.description, is_quiz = excluded.is_quiz, unlock_at = excluded.unlock_at,"
            " due_at = excluded.due_at, lock_at = excluded.lock_at, concept_id = excluded.concept_id,"
            " topic = excluded.topic",
            (a.id, kid_id, a.title, seal(key, a.description.encode(), aad("assignment", kid_id, a.id)),
             a.kind == "quiz", *(iso(t) if t else None for t in (a.unlock_at, a.due_at, a.lock_at)),
             a.concept_id, a.topic),
        )
    for a in changed:
        conn.execute("DELETE FROM assignment_item WHERE assignment_id = ?", (a.id,))
        for position, text in enumerate(a.items):
            vector = next(embedded) if embedded else None
            if vector is not None:
                item_id = f"{a.id}-{position}"
                conn.execute(
                    "INSERT INTO assignment_item(id, assignment_id, position, text, embedding) VALUES (?, ?, ?, ?, ?)",
                    (item_id, a.id, position, seal(key, text.encode(), aad("assignment_item", kid_id, item_id)),
                     np.asarray(vector, dtype=np.float32).tobytes()),
                )
    conn.commit()


def _nearest(group: list[tuple[Assignment, np.ndarray]], query_vec: np.ndarray | None) -> tuple[Assignment | None, float]:
    """The assignment with the item closest to the question, and that cosine."""
    best: tuple[Assignment | None, float] = (None, -1.0)
    if query_vec is None:
        return best
    for a, matrix in group:
        if len(matrix):
            best = max(best, (a, float(np.max(matrix @ query_vec))), key=lambda pair: pair[1])
    return best


async def homework_signal(
    deps: Deps, kid_id: str, query_vec: np.ndarray | None, concept_id: str | None, assigned_work_p: float,
    now: datetime,
) -> HomeworkSignal:
    stored = stored_assignments(deps.conn, deps.keys, kid_id)
    live = [(a, m) for a, m in stored if status(a, now) == "exam_live"]
    rest = [(a, m) for a, m in stored if status(a, now) != "exam_live"]

    if live:
        nearest, cosine = _nearest(live, query_vec)
        topic = deps.catalog.get(concept_id).topic if concept_id else None
        same = next((a for a, _ in live if concept_id and (a.concept_id == concept_id or a.topic == topic)), None)
        if cosine >= NEAR_QUIZ_COSINE or same or assigned_work_p >= ASSIGNED_WORK_THRESHOLD:
            quiz = nearest if cosine >= NEAR_QUIZ_COSINE else same or live[0][0]
            return HomeworkSignal("exam_live", quiz.title, True)

    matched, cosine = _nearest(rest, query_vec)
    if matched and cosine >= MATCH_COSINE:
        return HomeworkSignal(status(matched, now), matched.title, False)
    if not live and assigned_work_p >= ASSIGNED_WORK_THRESHOLD:
        return HomeworkSignal("open", None, False)
    return NO_HOMEWORK
