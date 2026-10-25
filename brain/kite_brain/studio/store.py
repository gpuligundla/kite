"""A creation on disk and on the bus, shared by movies and template games.

A creation lives under studio_pro.CREATIONS_DIR/{id}/ as creation.json (the public state, a
contract.Creation), meta.json (who it is for and where its evidence goes, never served), and its
media. It moves pending -> ready | fallback."""

import asyncio
import html
import json
import logging
import secrets
from collections.abc import Coroutine
from pathlib import Path
from typing import Any

import numpy as np
from pydantic import BaseModel

from kite_brain import studio_pro
from kite_brain.config import MATCH_COSINE
from kite_brain.contract import Creation, CreationKind, Grade
from kite_brain.deps import Deps
from kite_brain.memory.embed import top_k
from kite_brain.studio.sprites import sprite_svg

log = logging.getLogger(__name__)

_tasks: set[asyncio.Task] = set()


class Meta(BaseModel):
    """What the evidence endpoints need. `scored` makes the first answer or result the only one."""

    kid_id: str
    grade: Grade
    read_only: bool
    concept_id: str | None = None
    scored: bool = False


def new_id() -> str:
    return secrets.token_hex(16)


def folder(creation_id: str) -> Path:
    return studio_pro.CREATIONS_DIR / creation_id


def sprites_for(creation: Creation) -> dict[str, str]:
    """{slug: raw SVG markup} for every sprite the creation uses. Creation itself carries no sprite data."""
    slugs = {a.sprite for s in creation.storyboard.scenes for a in s.actors} if creation.storyboard else set()
    slugs |= {i.sprite for i in creation.game.items} if creation.game else set()
    return {slug: sprite_svg(slug) for slug in sorted(slugs)}


def save(creation: Creation) -> None:
    """creation.json is the Creation plus a top-level "sprites" map, which render.mjs reads."""
    path = folder(creation.id)
    path.mkdir(parents=True, exist_ok=True)
    data = creation.model_dump(mode="json") | {"sprites": sprites_for(creation)}
    (path / "creation.json").write_text(json.dumps(data, indent=2))


def load(creation_id: str) -> Creation:
    """FileNotFoundError when there is no such creation."""
    return Creation.model_validate_json((folder(creation_id) / "creation.json").read_text())


def save_meta(creation_id: str, meta: Meta) -> None:
    folder(creation_id).mkdir(parents=True, exist_ok=True)
    (folder(creation_id) / "meta.json").write_text(meta.model_dump_json())


def load_meta(creation_id: str) -> Meta | None:
    """None for a creation with no evidence trail, such as a brand-new game from the studio agent."""
    try:
        return Meta.model_validate_json((folder(creation_id) / "meta.json").read_text())
    except FileNotFoundError:
        return None


def publish(deps: Deps, kid_id: str, cls: type, kind: CreationKind, **fields: Any) -> None:
    """To the kid, with the grown-up copy to the parent. A creation is never a counselor matter."""
    for audience in ("kid", "parent"):
        deps.bus.publish(cls(kid_id=kid_id, turn_id=None, at=deps.clock(), audience=audience, kind=kind, **fields))


def spawn(coro: Coroutine) -> None:
    """Run in the background. The set keeps the task alive until it finishes."""
    task = asyncio.get_running_loop().create_task(coro)
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def settle() -> None:
    """Wait for every background creation job. The safety checks use it."""
    # A finished task stays in _tasks until its done callback runs, and gather over only finished
    # tasks never yields to the loop, so waiting on _tasks itself could spin forever.
    while pending := [t for t in _tasks if not t.done()]:
        await asyncio.gather(*pending, return_exceptions=True)


async def strings_are_safe(deps: Deps, texts: list[str]) -> bool:
    """Content Safety over everything a kid will read or hear, through the studio agent's screen."""
    return await studio_pro.text_is_safe(deps, "".join(f"<p>{html.escape(t)}</p>" for t in texts))


async def resolve_concept(deps: Deps, topic: str, learning_goal: str) -> str | None:
    """The catalog concept a creation teaches, found by the brain so Claude never names one.
    None when there are no vectors, the embed fails, or nothing is a close match."""
    if deps.catalog.vectors is None:
        return None
    try:
        query = (await deps.embed([f"{topic}. {learning_goal}"]))[0]
    except Exception as e:
        log.warning("concept lookup failed (%s)", type(e).__name__)
        return None
    best = top_k(query, np.asarray(deps.catalog.vectors), 1)
    if not best or best[0][1] < MATCH_COSINE:
        return None
    return deps.catalog.concepts[best[0][0]].id
