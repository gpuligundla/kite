"""Brand-new games (Studio Pro, M11). The brain asks the kite-studio hosted agent for one KAPLAY
game, screens every string the kid could read, saves the file under the creation and tells the
kid and the parent. Any failure, timeout or flag leaves her the template game (status fallback).

A creation moves pending -> ready | fallback, and creation.json is that state on disk."""

import asyncio
import itertools
import json
import logging
import re
import secrets
from collections.abc import Callable
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Literal, Protocol

import httpx
from azure.identity import DefaultAzureCredential

from kite_brain.config import STUDIO_AGENT_TIMEOUT_S, get_settings
from kite_brain.contract import Creation, CreationProgressEvent, CreationReadyEvent
from kite_brain.deps import Deps
from kite_brain.memory.recall import recall

log = logging.getLogger(__name__)

CREATIONS_DIR = Path("data/creations")
STEPS_TOTAL = 8  # the agent's turn cap; each progress line it streams counts as one step
INVOCATIONS_SCOPE = "https://ai.azure.com/.default"
SAFETY_CHUNK = 5000  # Content Safety takes 10k characters a call


@dataclass
class Playtest:
    passed: bool
    errors: list[str]


@dataclass
class GameResult:
    status: Literal["ready", "failed"]
    html: str | None
    playtest: Playtest


class StudioAgent(Protocol):
    async def build(self, request: dict, progress: Callable[[str], None]) -> GameResult: ...


def parse_result(msg: object) -> GameResult:
    """The agent's final line, or ValueError. Nothing it sends is trusted before this."""
    if not isinstance(msg, dict) or msg.get("status") not in ("ready", "failed"):
        raise ValueError("the studio agent sent no result")
    html = msg.get("html")
    if html is not None and not isinstance(html, str):
        raise ValueError("html must be a string")
    playtest = msg.get("playtest") or {}
    return GameResult(msg["status"], html, Playtest(bool(playtest.get("passed")), [str(e) for e in playtest.get("errors", [])]))


class FoundryStudioAgent:
    """The hosted agent over its Invocations endpoint, with an Entra token from the default
    credential chain. The creation id is the session id, so every game gets its own sandbox."""

    def __init__(self, endpoint: str):
        self.endpoint = endpoint
        self.credential = DefaultAzureCredential()

    async def build(self, request: dict, progress: Callable[[str], None]) -> GameResult:
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


def game_path(creation_id: str) -> Path:
    return CREATIONS_DIR / creation_id / "game.html"


def save(creation_id: str, status: Literal["pending", "ready", "fallback"], html: str | None = None) -> Creation:
    folder = CREATIONS_DIR / creation_id
    folder.mkdir(parents=True, exist_ok=True)
    if html is not None:
        (folder / "game.html").write_text(html)
    creation = Creation(
        id=creation_id, kind="game", status=status,
        html_url=f"/creations/{creation_id}/game.html" if html is not None else None,
    )
    (folder / "creation.json").write_text(creation.model_dump_json(indent=2))
    return creation


def _publish(deps: Deps, kid_id: str, cls, **fields) -> None:
    """To the kid, with the grown-up copy to the parent. A game is never a counselor matter."""
    for audience in ("kid", "parent"):
        deps.bus.publish(cls(kid_id=kid_id, turn_id=None, at=deps.clock(), audience=audience, kind="game", **fields))


def start_custom_game(deps: Deps, kid_id: str, topic: str, learning_goal: str) -> str:
    """A pending creation under an unguessable id, announced as step 0. build_custom_game does the work."""
    creation_id = secrets.token_hex(16)
    save(creation_id, "pending")
    _publish(deps, kid_id, CreationProgressEvent, creation_id=creation_id, step=0, steps_total=STEPS_TOTAL)
    return creation_id


async def request_for(deps: Deps, kid_id: str, creation_id: str, topic: str, learning_goal: str) -> dict:
    """What the agent gets: the topic, the goal, the grade and the kid view. Never levels."""
    grade = deps.conn.execute("SELECT grade FROM kid WHERE id = ?", (kid_id,)).fetchone()["grade"]
    view = (await recall(deps, kid_id, grade, None, None, 0.0)).kid_view
    return {"creation_id": creation_id, "topic": topic, "learning_goal": learning_goal, "grade": grade, "kid_view": view.model_dump()}


async def build_custom_game(
    deps: Deps, kid_id: str, creation_id: str, topic: str, learning_goal: str, *, agent: StudioAgent | None = None
) -> Creation:
    agent = agent or default_agent()
    steps = itertools.count(1)

    def progress(_text: str) -> None:  # the agent's words stay in the sandbox; only the count goes out
        _publish(deps, kid_id, CreationProgressEvent, creation_id=creation_id, step=min(next(steps), STEPS_TOTAL), steps_total=STEPS_TOTAL)

    html = None
    try:
        request = await request_for(deps, kid_id, creation_id, topic, learning_goal)
        result = await asyncio.wait_for(agent.build(request, progress), STUDIO_AGENT_TIMEOUT_S)
        if result.status == "ready" and result.html and await text_is_safe(deps, result.html):
            html = result.html
    except Exception as e:
        log.warning("brand-new game %s falls back: %s", creation_id, type(e).__name__)
    creation = save(creation_id, "ready" if html else "fallback", html)
    _publish(deps, kid_id, CreationReadyEvent, creation_id=creation_id, status=creation.status)
    return creation
