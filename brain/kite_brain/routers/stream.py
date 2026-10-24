from fastapi import APIRouter, Header, Request
from sse_starlette.sse import EventSourceResponse

from kite_brain.auth import Device, require

router = APIRouter()


@router.get("/kids/{kid_id}/events")
async def events(
    kid_id: str,
    request: Request,
    device: Device = require(),
    last_event_id: int | None = Header(default=None),
):
    async def stream():
        async for event in request.app.state.bus.subscribe(kid_id, device.kind, last_event_id):
            yield {"id": str(event.id), "event": event.type, "data": event.model_dump_json()}

    return EventSourceResponse(stream())
