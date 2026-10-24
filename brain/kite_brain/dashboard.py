"""The parent's view of one kid, as of a grade. Everything here is read-only except `set_policy`."""

import json
from datetime import datetime

from pydantic import BaseModel

from kite_brain import studio_pro
from kite_brain.contract import (
    AlertView, CardView, Creation, DashboardView, Grade, Moment, PolicyAction,
)
from kite_brain.crypto import aad, open_sealed
from kite_brain.deps import Deps
from kite_brain.memory import ledger, maps

SENSITIVE_TOPICS = ("death", "religion", "bodies", "war", "divorce")


class ContactView(BaseModel):
    name: str
    phone: str


def kid_row(deps: Deps, kid_id: str):
    return deps.conn.execute(
        "SELECT display_name, grade, family_id, school_start_year FROM kid WHERE id = ?", (kid_id,)
    ).fetchone()


def policy_for(deps: Deps, family_id: str) -> dict[str, PolicyAction]:
    """Same rows the pipeline reads at the start of every turn (`_Turn.policy`); a topic
    with no row means answer."""
    rows = deps.conn.execute("SELECT topic, action FROM policy WHERE family_id = ?", (family_id,)).fetchall()
    stored = {r["topic"]: r["action"] for r in rows}
    return {t: stored.get(t, "answer") for t in SENSITIVE_TOPICS}


def set_policy(deps: Deps, family_id: str, topic: str, action: PolicyAction) -> None:
    deps.conn.execute(
        "INSERT INTO policy(family_id, topic, action) VALUES (?, ?, ?)"
        " ON CONFLICT(family_id, topic) DO UPDATE SET action = excluded.action",
        (family_id, topic, action),
    )
    deps.conn.commit()


def receipt(deps: Deps, kid_id: str, what: str) -> None:
    deps.conn.execute(
        "INSERT INTO access_receipt(who, kid_id, what, at) VALUES ('parent', ?, ?, ?)",
        (kid_id, what, ledger.iso(deps.clock())),
    )
    deps.conn.commit()


def _cards(deps: Deps, kid_id: str, grade: Grade) -> list[CardView]:
    key = deps.keys.for_kid(kid_id)
    rows = deps.conn.execute(
        "SELECT * FROM big_question_card WHERE kid_id = ? AND grade <= ? ORDER BY at DESC", (kid_id, grade)
    ).fetchall()
    return [
        CardView(
            card_id=r["id"], grade=r["grade"], at=datetime.fromisoformat(r["at"]), topic=r["topic"],
            summary=open_sealed(key, r["summary"], aad("big_question_card", kid_id, r["id"])).decode(),
            starter=open_sealed(key, r["starter"], aad("big_question_card", kid_id, r["id"])).decode(),
        )
        for r in rows
    ]


def _alerts(deps: Deps, kid_id: str, until: datetime) -> list[AlertView]:
    """Parent-routed alerts only; the counselor's never reach this view. Excerpts stay sealed."""
    key = deps.keys.for_kid(kid_id)
    rows = deps.conn.execute(
        "SELECT * FROM alert WHERE kid_id = ? AND routed_to = 'parent' AND at <= ? ORDER BY at DESC",
        (kid_id, ledger.iso(until)),
    ).fetchall()
    out = []
    for r in rows:
        where = json.loads(open_sealed(key, r["location"], aad("alert", kid_id, r["id"]))) if r["location"] else {}
        out.append(AlertView(
            alert_id=r["id"], kinds=json.loads(r["kinds"]), at=datetime.fromisoformat(r["at"]),
            lat=where.get("lat"), lng=where.get("lng"),
        ))
    return out


def dashboard_view(deps: Deps, kid_id: str, grade: Grade) -> DashboardView:
    kid = kid_row(deps, kid_id)
    until = maps.school_year_end(kid["school_start_year"], grade)
    evts = ledger.events(deps.conn, deps.keys, kid_id, grade)
    moments: dict[int, list[str]] = {}
    for e in evts:
        if isinstance(e.payload, Moment):
            name = deps.catalog.get(e.payload.concept_id).kid_name
            moments.setdefault(e.grade, []).append(e.payload.text(name))
    return DashboardView(
        profile=maps.profile_view(evts),
        curiosity=maps.curiosity_map(evts, until),
        skills=maps.skills_map(evts, deps.catalog, grade),
        cards=_cards(deps, kid_id, grade),
        alerts=_alerts(deps, kid_id, until),
        moments_by_grade=moments,
        policy=policy_for(deps, kid["family_id"]),
        how_she_learns=maps.how_she_learns(evts),
    )


def contacts(deps: Deps, kid_id: str) -> list[ContactView]:
    key = deps.keys.for_kid(kid_id)
    return [
        ContactView(
            name=open_sealed(key, r["name"], aad("contact", kid_id, r["id"])).decode(),
            phone=open_sealed(key, r["phone"], aad("contact", kid_id, r["id"])).decode(),
        )
        for r in deps.conn.execute("SELECT id, name, phone FROM contact WHERE kid_id = ? ORDER BY id", (kid_id,))
    ]


def movies() -> list[Creation]:
    """Rendered movies, newest first. Creations carry no kid id, so this is every movie in the
    store: right for the one-family demo, needs a kid column before a second family."""
    found = []
    for path in studio_pro.CREATIONS_DIR.glob("*/creation.json"):
        creation = Creation.model_validate_json(path.read_text())
        if creation.kind == "movie" and creation.video_url:
            found.append((path.stat().st_mtime, creation))
    return [c for _, c in sorted(found, key=lambda p: -p[0])]
