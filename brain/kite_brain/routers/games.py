"""Brand-new games: a kid device asks for one, the brain builds it after replying, and the finished
file is served under its unguessable id with a policy that allows no network. A movie's director's
cut is served the same way."""

import re

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, constr

from kite_brain.auth import require
from kite_brain.studio_pro import build_custom_game, page_path, start_page

router = APIRouter()
CREATION_ID = re.compile(r"[0-9a-f]{32}")
# Inline script and style, data: URLs for sprites. No fetch, no frames, nothing remote.
CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:"


class CustomGame(BaseModel):
    topic: constr(strip_whitespace=True, min_length=1, max_length=200)
    learning_goal: constr(strip_whitespace=True, min_length=1, max_length=300)


@router.post("/kids/{kid_id}/games/custom", dependencies=[require("os", "handheld")])
async def custom_game(kid_id: str, body: CustomGame, request: Request, background: BackgroundTasks) -> dict[str, str]:
    deps = request.app.state.deps
    creation_id = start_page(deps, kid_id, "game")
    background.add_task(build_custom_game, deps, kid_id, creation_id, body.topic, body.learning_goal)
    return {"creation_id": creation_id}


@router.get("/creations/{creation_id}/{kind}.html")
def page_html(creation_id: str, kind: str) -> FileResponse:
    if kind not in ("game", "movie") or not CREATION_ID.fullmatch(creation_id) or not page_path(creation_id, kind).exists():
        raise HTTPException(404, "no such page")
    return FileResponse(page_path(creation_id, kind), media_type="text/html", headers={"Content-Security-Policy": CSP})
