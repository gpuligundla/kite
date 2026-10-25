"""The counselor's console. Everything here is about the kid's safety reports, never her learning, and every
route needs a counselor token for the kid that device is bound to."""

import json
from datetime import datetime, timezone
from typing import get_args

from fastapi import APIRouter, HTTPException, Request

from kite_brain.auth import Device, require
from kite_brain.contract import (
    CaseChange, CaseStatus, CaseUpdate, ContextTurn, CounselorAlertView, CounselorStudentView, ReceiptView,
)
from kite_brain.crypto import aad, open_sealed
from kite_brain.dashboard import receipt
from kite_brain.deps import Deps
from kite_brain.memory import ledger
from kite_brain.turn.route import alert_reply

router = APIRouter()

CONTEXT_ROWS = 6  # 3 exchanges, each a kid row and a Kite row
RECEIPTS_SHOWN = 200


def _history(deps: Deps, kid_id: str, alert_id: str) -> list[CaseChange]:
    key = deps.keys.for_kid(kid_id)
    return [
        CaseChange(
            status=r["status"], at=datetime.fromisoformat(r["at"]),
            note=open_sealed(key, r["note"], aad("alert_case", kid_id, r["id"])).decode() if r["note"] else None,
        )
        for r in deps.conn.execute(
            "SELECT id, status, at, note FROM alert_case WHERE alert_id = ? ORDER BY at, id", (alert_id,)
        )
    ]


def _context(deps: Deps, kid_id: str, alert, now: datetime) -> tuple[list[ContextTurn], bool]:
    """The turns before the alert in its own session, found by session id. Session turns live 30 days from
    their real insert time, which is the alert's expiry less its year."""
    purged = datetime.fromisoformat(alert["expires_at"]) - ledger.ALERT_TTL + ledger.SESSION_TURN_TTL <= now
    if purged or alert["session_id"] is None:
        return [], purged
    key = deps.keys.for_kid(kid_id)
    rows = deps.conn.execute(
        "SELECT id, role, at, text FROM session_turn WHERE kid_id = ? AND session_id = ? AND at < ?"
        " ORDER BY at DESC, id DESC LIMIT ?",
        (kid_id, alert["session_id"], alert["at"], CONTEXT_ROWS),
    ).fetchall()
    return [
        ContextTurn(role=r["role"], at=datetime.fromisoformat(r["at"]),
                    text=open_sealed(key, r["text"], aad("session_turn", kid_id, r["id"])).decode())
        for r in reversed(rows)
    ], False


def _alert_view(deps: Deps, kid_id: str, r, now: datetime) -> CounselorAlertView:
    key, a = deps.keys.for_kid(kid_id), aad("alert", kid_id, r["id"])
    kinds = json.loads(r["kinds"])
    excerpt = open_sealed(key, r["excerpt"], a).decode()
    where = json.loads(open_sealed(key, r["location"], a)) if r["location"] else {}
    history = _history(deps, kid_id, r["id"])
    context, purged = _context(deps, kid_id, r, now)
    return CounselorAlertView(
        alert_id=r["id"], kinds=kinds, at=datetime.fromisoformat(r["at"]), excerpt=excerpt,
        # pipeline._excerpt ends with "kid: <her words>", and her words never hold a newline.
        said=excerpt.rsplit("\n", 1)[-1].removeprefix("kid: "), reply=alert_reply(kinds),
        status=history[-1].status if history else "new", history=history,
        context=context, context_purged=purged, lat=where.get("lat"), lng=where.get("lng"),
    )


def _counselor_alert(deps: Deps, kid_id: str, alert_id: str):
    row = deps.conn.execute(
        "SELECT * FROM alert WHERE id = ? AND kid_id = ? AND routed_to = 'counselor'", (alert_id, kid_id)
    ).fetchone()
    if row is None:
        raise HTTPException(404, "no such report for this student")
    return row


@router.get("/counselor/alerts")
async def get_alerts(request: Request, device: Device = require("counselor")) -> list[CounselorAlertView]:
    """Counselor-routed alerts for the kid this device is bound to, newest first, each with its case and the
    turns before it. Every report returned is recorded as a receipt."""
    deps, kid_id = request.app.state.deps, device.kid_id
    now = datetime.now(timezone.utc)  # the real clock, as expiry is
    rows = deps.conn.execute(
        "SELECT * FROM alert WHERE kid_id = ? AND routed_to = 'counselor' ORDER BY at DESC", (kid_id,)
    ).fetchall()
    alerts = [_alert_view(deps, kid_id, r, now) for r in rows]
    for a in alerts:
        receipt(deps, kid_id, f"alert {a.alert_id}", who="counselor")
    return alerts


@router.put("/counselor/alerts/{alert_id}/status")
async def put_status(
    alert_id: str, body: CaseUpdate, request: Request, device: Device = require("counselor")
) -> list[CaseChange]:
    """Move a report's case, or add a note to it. Returns the case history, oldest first. Each change is a receipt."""
    deps, kid_id = request.app.state.deps, device.kid_id
    _counselor_alert(deps, kid_id, alert_id)
    note = (body.note or "").strip() or None
    history = _history(deps, kid_id, alert_id)
    if note is None and body.status == (history[-1].status if history else "new"):
        raise HTTPException(422, "the report already has that status; add a note or pick another status")
    ledger.record_case_change(
        deps.conn, deps.keys, kid_id=kid_id, alert_id=alert_id, status=body.status, note=note, at=deps.clock()
    )
    receipt(deps, kid_id, f"case {alert_id} {body.status}{' with a note' if note else ''}", who="counselor")
    return _history(deps, kid_id, alert_id)


@router.get("/counselor/student")
async def get_student(request: Request, device: Device = require("counselor")) -> CounselorStudentView:
    """The student's name, grade and safety picture: when Kite last heard from her and her reports by status."""
    deps, kid_id = request.app.state.deps, device.kid_id
    kid = deps.conn.execute(
        "SELECT display_name, grade, school_start_year FROM kid WHERE id = ?", (kid_id,)
    ).fetchone()
    # An alert turn stores no session turn, so the alert itself counts as hearing from her; learning events
    # outlast the 30-day session turns.
    last = deps.conn.execute(
        "SELECT MAX(at) FROM (SELECT at FROM session_turn WHERE kid_id = ?1 AND role = 'kid'"
        " UNION ALL SELECT at FROM learning_event WHERE kid_id = ?1 UNION ALL SELECT at FROM alert WHERE kid_id = ?1)",
        (kid_id,),
    ).fetchone()[0]
    reports: dict[CaseStatus, int] = dict.fromkeys(get_args(CaseStatus), 0)
    for r in deps.conn.execute(
        "SELECT COALESCE((SELECT status FROM alert_case c WHERE c.alert_id = a.id ORDER BY at DESC, id DESC LIMIT 1),"
        " 'new') AS status FROM alert a WHERE a.kid_id = ? AND a.routed_to = 'counselor'",
        (kid_id,),
    ):
        reports[r["status"]] += 1
    receipt(deps, kid_id, "student profile", who="counselor")
    return CounselorStudentView(
        name=kid["display_name"], grade=kid["grade"], school_start_year=kid["school_start_year"],
        last_heard=datetime.fromisoformat(last) if last else None, reports=reports,
    )


@router.get("/counselor/receipts")
async def get_receipts(request: Request, device: Device = require("counselor")) -> list[ReceiptView]:
    """The counselor's own reads and changes for this student, newest first. The parent's reads of learning data
    aren't the counselor's business, so they stay out."""
    deps, kid_id = request.app.state.deps, device.kid_id
    return [
        ReceiptView(who=r["who"], what=r["what"], at=datetime.fromisoformat(r["at"]))
        for r in deps.conn.execute(
            "SELECT who, what, at FROM access_receipt WHERE kid_id = ? AND who = 'counselor'"
            " ORDER BY at DESC, id DESC LIMIT ?",
            (kid_id, RECEIPTS_SHOWN),
        )
    ]
