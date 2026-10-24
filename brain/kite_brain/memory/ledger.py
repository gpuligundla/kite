"""The learning ledger: grade-stamped, encrypted events, sessions, forgetting and expiry."""

import asyncio
import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from pydantic import TypeAdapter
from ulid import ULID

from kite_brain.catalog import Catalog
from kite_brain.contract import AlertKind, Grade, LearningPayload
from kite_brain.crypto import FamilyKeys, aad, open_sealed, seal

SESSION_GAP = timedelta(minutes=30)
ALERT_TTL = timedelta(days=365)
SESSION_TURN_TTL = timedelta(days=30)
PURGE_INTERVAL_S = 3600
_PAYLOAD = TypeAdapter(LearningPayload)


@dataclass(frozen=True)
class LedgerEvent:
    id: str
    kid_id: str
    grade: Grade
    at: datetime
    session_id: str
    concept_id: str | None
    topic: str | None
    source_turn_id: str | None
    payload: LearningPayload


def iso(at: datetime) -> str:
    """Every stored timestamp is UTC ISO-8601, so SQL string order is time order."""
    if at.tzinfo is None:
        raise ValueError("timestamps must be timezone-aware")
    return at.astimezone(timezone.utc).isoformat()


def append(
    conn: sqlite3.Connection,
    keys: FamilyKeys,
    catalog: Catalog,
    *,
    kid_id: str,
    grade: Grade,
    at: datetime,
    session_id: str,
    payload: LearningPayload,
    source_turn_id: str | None,
    concept_id: str | None = None,
    topic: str | None = None,
) -> str:
    if concept_id is not None:
        topic = topic or catalog.get(concept_id).topic  # KeyError on an unknown concept
    event_id = str(ULID())
    sealed = seal(
        keys.for_kid(kid_id), payload.model_dump_json().encode(), aad("learning_event", kid_id, event_id)
    )
    conn.execute(
        "INSERT INTO learning_event(id, kid_id, grade, at, session_id, kind, concept_id, topic,"
        " source_turn_id, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (event_id, kid_id, grade, iso(at), session_id, payload.kind, concept_id, topic,
         source_turn_id, sealed),
    )
    conn.commit()
    return event_id


def events(conn: sqlite3.Connection, keys: FamilyKeys, kid_id: str, as_of_grade: Grade) -> list[LedgerEvent]:
    """Decrypted events stamped at or before `as_of_grade`, oldest first."""
    key = keys.for_kid(kid_id)
    rows = conn.execute(
        "SELECT * FROM learning_event WHERE kid_id = ? AND grade <= ? ORDER BY at, id",
        (kid_id, as_of_grade),
    ).fetchall()
    return [
        LedgerEvent(
            id=r["id"], kid_id=kid_id, grade=r["grade"], at=datetime.fromisoformat(r["at"]),
            session_id=r["session_id"], concept_id=r["concept_id"], topic=r["topic"],
            source_turn_id=r["source_turn_id"],
            payload=_PAYLOAD.validate_json(
                open_sealed(key, r["payload"], aad("learning_event", kid_id, r["id"]))
            ),
        )
        for r in rows
    ]


def session_for(conn: sqlite3.Connection, kid_id: str, at: datetime) -> str:
    """Reuse the kid's latest session when its last activity is 30 minutes ago or less."""
    last = conn.execute(
        "SELECT session_id, at FROM ("
        " SELECT session_id, at FROM session_turn WHERE kid_id = ?1 AND at <= ?2"
        " UNION ALL SELECT session_id, at FROM learning_event WHERE kid_id = ?1 AND at <= ?2"
        ") ORDER BY at DESC LIMIT 1",
        (kid_id, iso(at)),
    ).fetchone()
    if last and at - datetime.fromisoformat(last["at"]) <= SESSION_GAP:
        return last["session_id"]
    return str(ULID())


def record_alert(
    conn: sqlite3.Connection,
    keys: FamilyKeys,
    *,
    kid_id: str,
    kinds: list[AlertKind],
    routed_to: str,
    excerpt: str,
    at: datetime,
    location: dict[str, float] | None = None,
) -> str:
    """The safety record. Written even for read-only turns; kept for a year of real time."""
    alert_id = str(ULID())
    key, a = keys.for_kid(kid_id), aad("alert", kid_id, alert_id)
    conn.execute(
        "INSERT INTO alert(id, kid_id, kinds, routed_to, at, expires_at, excerpt, location)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (alert_id, kid_id, json.dumps(kinds), routed_to, iso(at),
         iso(datetime.now(timezone.utc) + ALERT_TTL), seal(key, excerpt.encode(), a),
         seal(key, json.dumps(location).encode(), a) if location else None),
    )
    conn.commit()
    return alert_id


def forget_turn(conn: sqlite3.Connection, kid_id: str, turn_id: str) -> int:
    """Delete a turn's learning events, moment vectors, session_turn row and card.
    Alerts stay as the safety record. Returns the number of events deleted."""
    event_ids = [
        r[0] for r in conn.execute(
            "SELECT id FROM learning_event WHERE kid_id = ? AND source_turn_id = ?", (kid_id, turn_id)
        )
    ]
    marks = ",".join("?" * len(event_ids))
    conn.execute(f"DELETE FROM moment_vector WHERE event_id IN ({marks})", event_ids)
    conn.execute(f"DELETE FROM learning_event WHERE id IN ({marks})", event_ids)
    conn.execute("DELETE FROM session_turn WHERE kid_id = ? AND id = ?", (kid_id, turn_id))
    conn.execute("DELETE FROM big_question_card WHERE kid_id = ? AND source_turn_id = ?", (kid_id, turn_id))
    conn.commit()
    return len(event_ids)


def purge_expired(conn: sqlite3.Connection, now: datetime) -> int:
    """Delete session turns and alerts past `expires_at`. `now` must be the real clock:
    expires_at was computed from real insert time, so simulated dates never expire."""
    deleted = 0
    for table in ("session_turn", "alert"):
        deleted += conn.execute(
            f"DELETE FROM {table} WHERE datetime(expires_at) <= datetime(?)", (iso(now),)
        ).rowcount
    conn.commit()
    return deleted


async def purge_loop(conn: sqlite3.Connection) -> None:
    """Run once at startup, then hourly. Start it from the app lifespan."""
    while True:
        purge_expired(conn, datetime.now(timezone.utc))
        await asyncio.sleep(PURGE_INTERVAL_S)
