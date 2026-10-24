from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, Request, UploadFile
from starlette.responses import JSONResponse
from ulid import ULID

from kite_brain.auth import Device, require
from kite_brain.config import UPLOAD_CAP_BYTES
from kite_brain.contract import DeviceKind, Mode
from kite_brain.turn.pipeline import TurnInput, run_turn

router = APIRouter()


class UploadCap:
    """ASGI middleware: refuse an over-cap /turns body from its Content-Length, before
    Starlette parses it, so an upload is never spooled to disk."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"] == "/turns":
            length = next((int(v) for k, v in scope["headers"] if k == b"content-length"), 0)
            if length > UPLOAD_CAP_BYTES:
                await JSONResponse({"detail": "upload over 900 KB"}, status_code=413)(scope, receive, send)
                return
        await self.app(scope, receive, send)


async def _bytes(upload: UploadFile | None) -> bytes | None:
    if upload is None:
        return None
    data = await upload.read()
    if len(data) > UPLOAD_CAP_BYTES:  # chunked uploads carry no Content-Length for UploadCap to see
        raise HTTPException(413, "upload over 900 KB")
    return data


@router.post("/turns")
async def post_turn(
    request: Request,
    background: BackgroundTasks,
    kid_id: Annotated[str, Form()],
    device: Annotated[DeviceKind, Form()],
    mode: Annotated[Mode, Form()] = "talk",
    text: Annotated[str | None, Form()] = None,
    audio: Annotated[UploadFile | None, File()] = None,
    image: Annotated[UploadFile | None, File()] = None,
    as_of_grade: Annotated[int | None, Form(ge=0, le=12)] = None,
    concept_id: Annotated[str | None, Form()] = None,
    caller: Device = require("os", "handheld"),
) -> dict[str, str]:
    if kid_id != caller.kid_id:
        raise HTTPException(403, "this device belongs to another kid")
    if text is None and audio is None:
        raise HTTPException(422, "send text or audio")
    if concept_id is not None:
        try:
            request.app.state.deps.catalog.get(concept_id)
        except KeyError:
            raise HTTPException(422, "unknown concept_id") from None
    if mode == "teach" and concept_id is None:
        raise HTTPException(422, "teach turns need a concept_id")
    inp = TurnInput(
        kid_id=kid_id, device=device, mode=mode, text=text, audio=await _bytes(audio),
        audio_mime=audio.content_type if audio else None, image=await _bytes(image),
        as_of_grade=as_of_grade, concept_id=concept_id,
    )
    turn_id = str(ULID())
    background.add_task(run_turn, inp, request.app.state.deps, turn_id)
    return {"turn_id": turn_id}
