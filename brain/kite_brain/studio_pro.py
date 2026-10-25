"""Pages the kite-studio hosted agent builds (Studio Pro, M11): brand-new games, and the director's
cut of a movie, which studio.movie starts. The brain asks the agent for one self-contained page,
screens every string the kid could read, adds its own media, saves the file under the creation and
tells the kid and the parent. Any failure, timeout or flag leaves her the template (status fallback).

A creation moves pending -> ready | fallback, and creation.json is that state on disk."""

import asyncio
import base64
import itertools
import json
import logging
import re
import secrets
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Literal, Protocol

import httpx
from azure.identity import DefaultAzureCredential

from kite_brain.config import STUDIO_AGENT_TIMEOUT_S, get_settings
from kite_brain.contract import Creation, CreationKind, CreationProgressEvent, CreationReadyEvent
from kite_brain.deps import Deps
from kite_brain.memory.recall import recall

log = logging.getLogger(__name__)

CREATIONS_DIR = Path("data/creations")
STEPS_TOTAL = 14  # the agent's turn cap; each progress line it streams counts as one step
INVOCATIONS_SCOPE = "https://ai.azure.com/.default"
SAFETY_CHUNK = 5000  # Content Safety takes 10k characters a call
# The kid UI's own sounds (apps/web/public/sounds), for kite.sound() in a brand-new game.
GAME_SOUNDS = {name: Path(__file__).with_name("studio") / "sounds" / f"{name}.mp3" for name in ("correct", "oops", "cheer", "ready")}


@dataclass
class Playtest:
    passed: bool
    errors: list[str]


@dataclass
class PageResult:
    status: Literal["ready", "failed"]
    html: str | None
    playtest: Playtest


class StudioAgent(Protocol):
    async def build(self, request: dict, progress: Callable[[str], None]) -> PageResult: ...


def parse_result(msg: object) -> PageResult:
    """The agent's final line, or ValueError. Nothing it sends is trusted before this."""
    if not isinstance(msg, dict) or msg.get("status") not in ("ready", "failed"):
        raise ValueError("the studio agent sent no result")
    html = msg.get("html")
    if html is not None and not isinstance(html, str):
        raise ValueError("html must be a string")
    playtest = msg.get("playtest") or {}
    return PageResult(msg["status"], html, Playtest(bool(playtest.get("passed")), [str(e) for e in playtest.get("errors", [])]))


class FoundryStudioAgent:
    """The hosted agent over its Invocations endpoint, with an Entra token from the default
    credential chain. The creation id is the session id, so every game gets its own sandbox."""

    def __init__(self, endpoint: str):
        self.endpoint = endpoint
        self.credential = DefaultAzureCredential()

    async def build(self, request: dict, progress: Callable[[str], None]) -> PageResult:
        token = (await asyncio.to_thread(self.credential.get_token, INVOCATIONS_SCOPE)).token
        last = None
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, read=STUDIO_AGENT_TIMEOUT_S)) as http, http.stream(
            "POST", self.endpoint, json=request,
            params={"api-version": "v1", "agent_session_id": request["creation_id"]},
            headers={"Authorization": f"Bearer {token}"},
        ) as r:
            r.raise_for_status()
            async for line in r.aiter_lines():
                line = line.strip()
                if not line or line.startswith(":"):  # blank or keep-alive comment
                    continue
                msg = json.loads(line.removeprefix("data:"))
                if "progress" in msg:
                    progress(str(msg["progress"]))
                else:
                    last = msg
        return parse_result(last)


def default_agent() -> StudioAgent:
    return FoundryStudioAgent(get_settings().STUDIO_AGENT_ENDPOINT)


# ---- Screening ----------------------------------------------------------------


class _Texts(HTMLParser):
    """Everything a kid could read: text nodes, plus string literals in the game's own script.
    The kit's scripts (data-kit) are ours and skipped."""

    STRING = re.compile(r'"((?:[^"\\\n]|\\.)*)"|\'((?:[^\'\\\n]|\\.)*)\'|`((?:[^`\\]|\\.)*)`')

    def __init__(self):
        super().__init__()
        self.texts: list[str] = []
        self.mode = "text"

    def handle_starttag(self, tag, attrs):
        if tag == "style" or "data-kit" in dict(attrs):
            self.mode = "skip"
        elif tag == "script":
            self.mode = "script"

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.mode = "text"

    def handle_data(self, data):
        if self.mode == "text":
            self.texts.append(data)
        elif self.mode == "script":
            self.texts += ["".join(m) for m in self.STRING.findall(data)]


def text_strings(html: str) -> list[str]:
    parser = _Texts()
    parser.feed(html)
    return [t.strip() for t in parser.texts if re.search(r"[A-Za-z]{2}", t)]


def _chunks(texts: list[str]) -> list[str]:
    chunks, current = [], ""
    for t in texts:
        if current and len(current) + len(t) > SAFETY_CHUNK:
            chunks.append(current)
            current = ""
        current += t + "\n"
    return chunks + [current] if current else chunks


async def text_is_safe(deps: Deps, html: str) -> bool:
    """Content Safety over every string. A failed check counts as flagged."""
    for chunk in _chunks(text_strings(html)):
        try:
            ok = await deps.safety.check_output(chunk)
        except Exception:
            ok = False
        if not ok:
            return False
    return True


# ---- The creation on disk and on the bus ---------------------------------------


def page_path(creation_id: str, kind: CreationKind) -> Path:
    return CREATIONS_DIR / creation_id / f"{kind}.html"


def save(
    creation_id: str, kind: CreationKind, status: Literal["pending", "ready", "fallback"], html: str | None = None, **fields: Any
) -> Creation:
    folder = CREATIONS_DIR / creation_id
    folder.mkdir(parents=True, exist_ok=True)
    if html is not None:
        page_path(creation_id, kind).write_text(html)
    creation = Creation(
        id=creation_id, kind=kind, status=status,
        html_url=f"/creations/{creation_id}/{kind}.html" if html is not None else None, **fields,
    )
    (folder / "creation.json").write_text(creation.model_dump_json(indent=2))
    return creation


def _publish(deps: Deps, kid_id: str, cls, kind: CreationKind, **fields) -> None:
    """To the kid, with the grown-up copy to the parent. A creation is never a counselor matter."""
    for audience in ("kid", "parent"):
        deps.bus.publish(cls(kid_id=kid_id, turn_id=None, at=deps.clock(), audience=audience, kind=kind, **fields))


def start_page(deps: Deps, kid_id: str, kind: CreationKind) -> str:
    """A pending creation under an unguessable id, announced as step 0. build_page does the work."""
    creation_id = secrets.token_hex(16)
    save(creation_id, kind, "pending")
    _publish(deps, kid_id, CreationProgressEvent, kind, creation_id=creation_id, step=0, steps_total=STEPS_TOTAL)
    return creation_id


def inject(html: str, name: str, files: dict[str, Path]) -> str:
    """The page with the kit's empty `window.<name>` slot filled with each MP3 as a base64 data: URL,
    which the page's media-src data: policy allows. ValueError when the page has no slot."""
    slot = f'<script data-kit="{name}">window.{name} = {{}};</script>'
    if slot not in html:
        raise ValueError(f"the page has no {name} slot")
    urls = {key: "data:audio/mpeg;base64," + base64.b64encode(path.read_bytes()).decode() for key, path in files.items()}
    return html.replace(slot, f'<script data-kit="{name}">window.{name} = {json.dumps(urls)};</script>', 1)


async def build_page(
    deps: Deps, kid_id: str, creation_id: str, kind: CreationKind, request: Awaitable[dict],
    finish: Callable[[str], str] = lambda html: html, *, agent: StudioAgent | None = None, ready_fields: dict | None = None,
) -> Creation:
    """Ask the studio agent for the page, screen its text, finish it (the brain's own media go in
    here) and save it, with `ready_fields` on the Creation when it is ready. Never raises: any
    failure, flag or timeout saves a fallback."""
    agent = agent or default_agent()
    steps = itertools.count(1)

    def progress(_text: str) -> None:  # the agent's words stay in the sandbox; only the count goes out
        _publish(deps, kid_id, CreationProgressEvent, kind, creation_id=creation_id, step=min(next(steps), STEPS_TOTAL), steps_total=STEPS_TOTAL)

    html = None
    try:
        result = await asyncio.wait_for(agent.build(await request, progress), STUDIO_AGENT_TIMEOUT_S)
        if result.status == "ready" and result.html and await text_is_safe(deps, result.html):
            html = finish(result.html)
    except Exception as e:
        log.warning("studio %s %s falls back: %s", kind, creation_id, type(e).__name__)
    creation = save(creation_id, kind, "ready", html, **(ready_fields or {})) if html else save(creation_id, kind, "fallback")
    _publish(deps, kid_id, CreationReadyEvent, kind, creation_id=creation_id, status=creation.status)
    return creation


async def request_for(deps: Deps, kid_id: str, creation_id: str, topic: str, learning_goal: str) -> dict:
    """What the agent gets: the topic, the goal, the grade and the kid view. Never levels."""
    grade = deps.conn.execute("SELECT grade FROM kid WHERE id = ?", (kid_id,)).fetchone()["grade"]
    view = (await recall(deps, kid_id, grade, None, None, 0.0)).kid_view
    return {"creation_id": creation_id, "topic": topic, "learning_goal": learning_goal, "grade": grade, "kid_view": view.model_dump()}


async def build_custom_game(
    deps: Deps, kid_id: str, creation_id: str, topic: str, learning_goal: str, *, agent: StudioAgent | None = None
) -> Creation:
    return await build_page(
        deps, kid_id, creation_id, "game", request_for(deps, kid_id, creation_id, topic, learning_goal),
        lambda html: inject(html, "KITE_SOUNDS", GAME_SOUNDS), agent=agent,
    )
