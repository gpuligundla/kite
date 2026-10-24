from fastapi import APIRouter, Request
from pydantic import BaseModel

from kite_brain.auth import require
from kite_brain.contract import AlertEvent
from kite_brain.memory import ledger

router = APIRouter()


class Sos(BaseModel):
    lat: float
    lng: float


@router.post("/kids/{kid_id}/sos", dependencies=[require("os", "handheld")])
async def sos(kid_id: str, body: Sos, request: Request) -> dict[str, str]:
    deps = request.app.state.deps
    alert_id = ledger.record_alert(
        deps.conn, deps.keys, kid_id=kid_id, kinds=["sos"], routed_to="parent", excerpt="SOS button",
        at=deps.clock(), location=body.model_dump(),
    )
    deps.bus.publish(AlertEvent(
        kid_id=kid_id, turn_id=None, at=deps.clock(), audience="parent", alert_id=alert_id,
        kinds=["sos"], routed_to="parent", lat=body.lat, lng=body.lng,
    ))
    return {"alert_id": alert_id}
