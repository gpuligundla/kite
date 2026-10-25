"""Movies, stories and template games. A kid device starts one and answers its check question or reports
its score. Anyone with the unguessable id may read it, because it is a cartoon with no kid data in it
(the rate limiter skips /creations/ for the same reason)."""

import re
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field, constr, model_validator

from kite_brain.auth import Device, require
from kite_brain.contract import ConceptEvidence, Creation, CreationKind, Outcome, StoryMode, StoryPurpose
from kite_brain.memory import ledger
from kite_brain.studio import store
from kite_brain.studio.game import start_game
from kite_brain.studio.movie import start_movie
from kite_brain.studio.sprites import sprite_svg
from kite_brain.studio.story import start_story

router = APIRouter()
CREATION_ID = re.compile(r"[0-9a-f]{32}")
FILE_NAME = re.compile(r"[A-Za-z0-9_-]+\.(mp3|mp4)")
SPRITE_NAME = re.compile(r"[a-z0-9_-]{1,40}")
MEDIA_TYPES = {"mp3": "audio/mpeg", "mp4": "video/mp4"}
GOT_IT_SCORE, PARTLY_SCORE = 0.8, 0.5  # share of a game's items the kid got right


class NewCreation(BaseModel):
    kind: CreationKind
    topic: constr(strip_whitespace=True, min_length=1, max_length=200)
    learning_goal: constr(strip_whitespace=True, max_length=300) = ""
    mode: StoryMode = "story"  # stories only
    purpose: StoryPurpose = "learn"  # stories only

    @model_validator(mode="after")
    def _goal_when_teaching(self):
        if not self.learning_goal and (self.kind != "story" or self.purpose == "learn"):
            raise ValueError("learning_goal is required unless it is a fun or feelings story")
        return self


class Answer(BaseModel):
    choice: Annotated[int, Field(ge=0)]


class Result(BaseModel):
    correct: Annotated[int, Field(ge=0)]
    total: Annotated[int, Field(ge=1)]


def _creation(creation_id: str) -> Creation:
    if not CREATION_ID.fullmatch(creation_id):
        raise HTTPException(404, "no such creation")
    try:
        return store.load(creation_id)
    except FileNotFoundError:
        raise HTTPException(404, "no such creation") from None


def _own(creation_id: str, kinds: set[CreationKind], device: Device) -> tuple[Creation, store.Meta | None]:
    """The creation and its meta (none for a brand-new studio game), when it is this kid's and of one of `kinds`."""
    creation = _creation(creation_id)
    meta = store.load_meta(creation_id)
    if meta and meta.kid_id != device.kid_id:
        raise HTTPException(404, "no such creation")
    if creation.kind not in kinds:
        raise HTTPException(409, f"this is a {creation.kind}, not a {' or '.join(sorted(kinds))}")
    return creation, meta


def _record(
    request: Request, creation_id: str, meta: store.Meta | None, outcome: Outcome, source: Literal["check_question", "game"]
) -> bool:
    """Append the evidence once per creation, unless the turn was a time-travel one or the
    creation teaches no catalog concept."""
    deps = request.app.state.deps
    if meta is None or meta.scored or meta.read_only or meta.concept_id is None:
        return False
    now = deps.clock()
    ledger.append(
        deps.conn, deps.keys, deps.catalog, kid_id=meta.kid_id, grade=meta.grade, at=now,
        session_id=ledger.session_for(deps.conn, meta.kid_id, now), source_turn_id=None,
        payload=ConceptEvidence(outcome=outcome, source=source), concept_id=meta.concept_id,
    )
    store.save_meta(creation_id, meta.model_copy(update={"scored": True}))
    return True


@router.post("/creations")
async def create(body: NewCreation, request: Request, device: Device = require("os", "handheld")) -> dict[str, str]:
    deps = request.app.state.deps
    grade = deps.conn.execute("SELECT grade FROM kid WHERE id = ?", (device.kid_id,)).fetchone()["grade"]
    if body.kind == "story":
        creation_id = await start_story(
            deps, device.kid_id, body.topic, body.learning_goal, grade, mode=body.mode, purpose=body.purpose
        )
        return {"creation_id": creation_id}
    start = start_movie if body.kind == "movie" else start_game
    return {"creation_id": await start(deps, device.kid_id, body.topic, body.learning_goal, grade)}


@router.get("/creations/sprites/{name}")
def sprite(name: str) -> Response:
    if not SPRITE_NAME.fullmatch(name):
        raise HTTPException(404, "no such sprite")
    try:
        svg = sprite_svg(name)
    except KeyError:
        raise HTTPException(404, "no such sprite") from None
    return Response(svg, media_type="image/svg+xml", headers={"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'"})


@router.get("/creations/{creation_id}")
def read(creation_id: str) -> dict:
    """The creation with its audio as URLs the player can fetch, plus a "sprites" map of slug to SVG markup."""
    creation = _creation(creation_id)
    audio = {key: f"/creations/{creation_id}/files/{name}" for key, name in creation.audio.items()}
    return creation.model_copy(update={"audio": audio}).model_dump(mode="json") | {"sprites": store.sprites_for(creation)}


@router.get("/creations/{creation_id}/files/{name}")
def file(creation_id: str, name: str) -> FileResponse:
    if not CREATION_ID.fullmatch(creation_id) or not FILE_NAME.fullmatch(name):
        raise HTTPException(404, "no such file")
    path = store.folder(creation_id) / name
    if not path.is_file():
        raise HTTPException(404, "no such file")
    return FileResponse(path, media_type=MEDIA_TYPES[name.rsplit(".", 1)[1]])


@router.post("/creations/{creation_id}/answer")
async def answer(creation_id: str, body: Answer, request: Request, device: Device = require("os", "handheld")) -> dict:
    creation, meta = _own(creation_id, {"movie", "story"}, device)
    # A story asks a graded question only when it is a learn story told by day.
    told = creation.storyboard or creation.storybook
    check = told.check if told else None
    if check is None:
        raise HTTPException(409, f"this {creation.kind} has no question to answer")
    if body.choice >= len(check.choices):
        raise HTTPException(422, "no such choice")
    correct = body.choice == check.correct_index
    recorded = _record(request, creation_id, meta, "got_it" if correct else "not_yet", "check_question")
    return {"correct": correct, "correct_index": check.correct_index, "recorded": recorded}


@router.post("/creations/{creation_id}/result")
async def result(creation_id: str, body: Result, request: Request, device: Device = require("os", "handheld")) -> dict:
    _, meta = _own(creation_id, {"game"}, device)
    if body.correct > body.total:
        raise HTTPException(422, "correct is more than total")
    share = body.correct / body.total
    outcome: Outcome = "got_it" if share >= GOT_IT_SCORE else "partly" if share >= PARTLY_SCORE else "not_yet"
    return {"recorded": _record(request, creation_id, meta, outcome, "game")}
