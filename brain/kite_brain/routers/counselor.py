import json
from datetime import datetime

from fastapi import APIRouter, Request

from kite_brain.auth import Device, require
from kite_brain.contract import CounselorAlertView
from kite_brain.crypto import aad, open_sealed
from kite_brain.dashboard import receipt

router = APIRouter()


@router.get("/counselor/alerts")
def get_alerts(request: Request, device: Device = require("counselor")) -> list[CounselorAlertView]:
    """Counselor-routed alerts for the kid this device is bound to, newest first, with their
    excerpts. Every excerpt returned is recorded as a receipt."""
    deps, kid_id = request.app.state.deps, device.kid_id
    key = deps.keys.for_kid(kid_id)
    rows = deps.conn.execute(
        "SELECT id, kinds, at, excerpt FROM alert WHERE kid_id = ? AND routed_to = 'counselor' ORDER BY at DESC",
        (kid_id,),
    ).fetchall()
    alerts = [
        CounselorAlertView(
            alert_id=r["id"], kinds=json.loads(r["kinds"]), at=datetime.fromisoformat(r["at"]),
            excerpt=open_sealed(key, r["excerpt"], aad("alert", kid_id, r["id"])).decode(),
        )
        for r in rows
    ]
    for a in alerts:
        receipt(deps, kid_id, f"alert {a.alert_id}", who="counselor")
    return alerts
