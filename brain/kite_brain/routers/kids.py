import base64
import binascii
import logging
import re
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from kite_brain import studio_pro
from kite_brain.auth import require
from kite_brain.config import UPLOAD_CAP_BYTES
from kite_brain.contract import AlertEvent, Creation, CreationKind, KidView
from kite_brain.crypto import aad, open_sealed
from kite_brain.memory import ledger
from kite_brain.memory.recall import PastChat, past_chats, remembered
from kite_brain.studio import store
from kite_brain.turn.pipeline import forget_time_travel, start_teach, teachable_concepts, teaching_now

log = logging.getLogger(__name__)
router = APIRouter()
HTML_TITLE = re.compile(r"<title>([^<]{1,120})</title>")


class Me(BaseModel):
    name: str
    grade: int


class FreshStart(BaseModel):
    at: datetime


class Spoken(BaseModel):
    audio_b64: str = Field(max_length=UPLOAD_CAP_BYTES * 4 // 3 + 4)
    mime: str = Field(default="audio/webm", pattern=r"^audio/[a-z0-9.+-]{1,30}$")


class Heard(BaseModel):
    text: str


class Sos(BaseModel):
    # None when the phone couldn't get a location: the SOS still goes through.
    lat: float | None = None
    lng: float | None = None


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


class TeachStart(BaseModel):
    concept_id: str


class Teachable(BaseModel):
    concept_id: str
    kid_name: str


@router.post("/kids/{kid_id}/teach/start", dependencies=[require("os", "handheld")])
async def teach_start(kid_id: str, body: TeachStart, request: Request) -> dict[str, bool]:
    deps = request.app.state.deps
    try:
        deps.catalog.get(body.concept_id)
    except KeyError:
        raise HTTPException(422, "unknown concept_id") from None
    await start_teach(deps, kid_id, body.concept_id)
    return {"ok": True}


@router.get("/kids/{kid_id}/teachable", dependencies=[require("os", "handheld")])
async def teachable(kid_id: str, request: Request) -> list[Teachable]:
    """Concepts she has met, most recent first, in kid words. Never levels."""
    deps = request.app.state.deps
    return [Teachable(concept_id=c, kid_name=deps.catalog.get(c).kid_name) for c in teachable_concepts(deps, kid_id)]


@router.get("/kids/{kid_id}/teach/active", dependencies=[require("os", "handheld")])
async def teach_active(kid_id: str, request: Request) -> Teachable | None:
    """The Teach Kite lesson the brain just started, so a screen can follow one the kid began by voice."""
    deps = request.app.state.deps
    concept_id = teaching_now(deps, kid_id)
    return Teachable(concept_id=concept_id, kid_name=deps.catalog.get(concept_id).kid_name) if concept_id else None


@router.get("/kids/{kid_id}/kid-view", dependencies=[require("os", "handheld")])
async def kid_view(kid_id: str, request: Request) -> KidView:
    """What Kite remembers, as the kid may see it. Never levels or scores."""
    return remembered(request.app.state.deps, kid_id)


@router.get("/kids/{kid_id}/history", dependencies=[require("os", "handheld")])
async def history(kid_id: str, request: Request) -> list[PastChat]:
    """Past chats, read-only, for the kid's own screen: what was said, never levels or scores."""
    return past_chats(request.app.state.deps, kid_id, datetime.now(timezone.utc))


@router.get("/kids/{kid_id}/me", dependencies=[require("os", "handheld")])
async def me(kid_id: str, request: Request) -> Me:
    """The kid's name and grade, so their screen can greet them and match its look to their age."""
    row = request.app.state.deps.conn.execute("SELECT display_name, grade FROM kid WHERE id = ?", (kid_id,)).fetchone()
    return Me(name=row["display_name"], grade=row["grade"])


@router.post("/kids/{kid_id}/fresh-start", dependencies=[require("os", "handheld")])
async def fresh_start(kid_id: str, request: Request) -> FreshStart:
    """New topic: Kite's next answer leans on nothing said before now, a new session begins, and the time-travel
    exchanges go. What Kite remembers about the kid (the ledger, the kid view) stays."""
    deps = request.app.state.deps
    at = deps.clock()
    ledger.mark_fresh_start(deps.conn, kid_id, at)
    forget_time_travel(kid_id)
    return FreshStart(at=at)


@router.post("/kids/{kid_id}/hear", dependencies=[require("os", "handheld")])
async def hear(kid_id: str, body: Spoken, request: Request) -> Heard:
    """Only the words, for a screen that asked one thing ("What should your movie be about?"). The screen sends
    them on in a turn, where safety and routing see them, so nothing is checked or stored here."""
    try:
        audio = base64.b64decode(body.audio_b64, validate=True)
    except binascii.Error:
        raise HTTPException(422, "audio_b64 is not base64") from None
    try:
        text = await request.app.state.deps.stt.transcribe(audio, body.mime)
    except Exception as e:  # the type only: a vendor error body can echo the kid's words
        log.warning("hear: stt failed (%s)", type(e).__name__)
        text = ""
    return Heard(text=re.sub(r"\s+", " ", text).strip())


class ContactName(BaseModel):
    """A name only: the kid's phone shows who it may call, and the numbers stay on the grown-up side."""

    id: str
    name: str


@router.get("/kids/{kid_id}/approved-contacts", dependencies=[require("os", "handheld")])
async def approved_contacts(kid_id: str, request: Request) -> list[ContactName]:
    """The people the grown-ups approved, by name. The phone numbers are never decrypted here."""
    deps = request.app.state.deps
    key = deps.keys.for_kid(kid_id)
    rows = deps.conn.execute("SELECT id, name FROM contact WHERE kid_id = ? ORDER BY id", (kid_id,)).fetchall()
    return [ContactName(id=r["id"], name=open_sealed(key, r["name"], aad("contact", kid_id, r["id"])).decode()) for r in rows]


class MadeThing(BaseModel):
    id: str
    kind: CreationKind
    title: str


def _title(folder, creation) -> str:
    for part in (creation.storyboard, creation.storybook, creation.game):
        if part is not None:
            return part.title
    for page in sorted(folder.glob("*.html")):
        if found := HTML_TITLE.search(page.read_text(errors="ignore")[:4000]):
            return found.group(1).strip()
    return "Something you made"


@router.get("/kids/{kid_id}/creations", dependencies=[require("os", "handheld")])
async def my_creations(kid_id: str, request: Request) -> list[MadeThing]:
    """Finished movies, games and stories, newest first, for the My creations app. A creation Kite made for another
    kid is left out. One with no maker on record (the showcase, a studio-agent game) is shown: right for the one-family
    demo, and the same store the parent's movie list reads."""
    found = []
    for path in studio_pro.CREATIONS_DIR.glob("*/creation.json"):
        try:
            creation = Creation.model_validate_json(path.read_text())
        except ValueError:
            continue
        meta = store.load_meta(creation.id)
        if creation.status == "pending" or (meta is not None and meta.kid_id != kid_id):
            continue
        found.append((path.stat().st_mtime, MadeThing(id=creation.id, kind=creation.kind, title=_title(path.parent, creation))))
    return [made for _, made in sorted(found, key=lambda pair: -pair[0])]
