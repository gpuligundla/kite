"""Template games (spec section 9, Task 27). Claude fills in a `catch` or `sort` template as a
GameSpec and writes no game code. A spec that is late, flagged or unusable is replaced by the
cached sky-is-blue catch game, so the kid always gets a game."""

import asyncio
import logging

from kite_brain import studio_pro
from kite_brain.contract import (
    Creation, CreationProgressEvent, CreationReadyEvent, GameItem, GameSpec, Grade, KidView,
)
from kite_brain.deps import Deps, LlmRequest
from kite_brain.memory.recall import recall
from kite_brain.policy import _kid_view_lines, band_for
from kite_brain.studio import store
from kite_brain.studio.sprites import canonical, sprite_names
from kite_brain.studio.storyboard import NO_CONCEPT

log = logging.getLogger(__name__)

GAME_DEADLINE_S = 20.0
MAX_ITEMS = 12
MAX_LABEL = 40

SYSTEM = """You fill in a template for a tiny 2D game that practices one idea with a child. You write no code.
Reading level: grade {fk_max:g} or lower. Style for this age: {style}

Templates:
- catch: items fall and the child catches the right ones. Every item has a label, a sprite and correct (true or false). Leave bins empty. Include both right and wrong items.
- sort: the child drags each item into one of 2 or 3 bins. Put the bin names in bins. Every item has a label, a sprite and a bin that is exactly one of those names. Leave correct unset.

Rules:
- Pick the template that fits the idea. 6 to 10 items. Labels are one to three words.
- Sprites use only these names: {sprites}. Rexy is the sprite trex.
- title is short and playful. instructions is one sentence the child can follow. Set concept_id to "{no_concept}".
- Be kind and accurate. Nothing scary, violent or about the child's personal details."""

SKY_GAME = GameSpec(
    template="catch",
    title="Catch the blue light!",
    instructions="Blue light bounces around the sky. Catch the blue light and let the other colors go by.",
    concept_id="light_sky_blue",
    items=[
        GameItem(label="Blue light", sprite="blue_circle", correct=True),
        GameItem(label="Blue light", sprite="blue_square", correct=True),
        GameItem(label="Blue light", sprite="sparkles", correct=True),
        GameItem(label="Red light", sprite="red_circle", correct=False),
        GameItem(label="Red light", sprite="red_square", correct=False),
        GameItem(label="Green light", sprite="green_square", correct=False),
        GameItem(label="Yellow light", sprite="yellow_square", correct=False),
    ],
)


def game_request(topic: str, learning_goal: str, kid_view: KidView, grade: Grade) -> LlmRequest:
    band = band_for(grade)
    system = SYSTEM.format(
        fk_max=band.fk_max, style=band.style, no_concept=NO_CONCEPT, sprites=", ".join(sorted(sprite_names()))
    )
    context = "\n".join([f"The child is in grade {grade}.", *_kid_view_lines(kid_view)])
    task = f"Make the game. Topic: {topic}\nWhat the child should practice: {learning_goal}"
    return LlmRequest(system=system, context=context, messages=[{"role": "user", "content": task}])


def validate(spec: GameSpec) -> GameSpec:
    """Sprites from the set (by canonical name), a playable catch game, a sane size. KeyError or ValueError otherwise."""
    if len(spec.items) > MAX_ITEMS or any(len(i.label) > MAX_LABEL for i in spec.items):
        raise ValueError("too many items or a label that is too long")
    for item in spec.items:
        item.sprite = canonical(item.sprite)
    if spec.template == "catch" and len({i.correct for i in spec.items}) < 2:
        raise ValueError("a catch game needs items to catch and items to let go")
    return spec


def readable_text(spec: GameSpec) -> list[str]:
    return [spec.title, spec.instructions, *spec.bins, *(i.label for i in spec.items)]


async def write_game(deps: Deps, topic: str, learning_goal: str, kid_view: KidView, grade: Grade) -> GameSpec:
    """Sonnet with adaptive thinking at medium effort, parsed straight into a GameSpec. A spec that doesn't parse
    or validate gets one more try before the sky game stands in."""
    request = game_request(topic, learning_goal, kid_view, grade)
    try:
        return validate(await deps.llm.parse(request, GameSpec, deep=True))
    except ValueError as e:
        log.warning("game spec rejected (%s), asking once more", type(e).__name__)
        return validate(await deps.llm.parse(request, GameSpec, deep=True))


async def start_game(
    deps: Deps, kid_id: str, topic: str, learning_goal: str, grade: Grade, *, read_only: bool = False
) -> str:
    """A pending creation under an unguessable id, announced as step 0 of 1. build_game runs in the background."""
    creation_id = store.new_id()
    store.save(Creation(id=creation_id, kind="game", status="pending"))
    store.save_meta(creation_id, store.Meta(kid_id=kid_id, grade=grade, read_only=read_only))
    store.publish(deps, kid_id, CreationProgressEvent, "game", creation_id=creation_id, step=0, steps_total=1)
    store.spawn(build_game(deps, kid_id, creation_id, topic, learning_goal, grade))
    return creation_id


async def _make(deps: Deps, kid_id: str, topic: str, learning_goal: str, grade: Grade) -> tuple[GameSpec, str | None]:
    try:
        kid_view = (await recall(deps, kid_id, grade, None, None, 0.0)).kid_view
    except Exception as e:  # a game without personalization beats the fallback
        log.warning("game kid view failed (%s)", type(e).__name__)
        kid_view = KidView(interests=[], characters=[], moments=[], deep_topics=[])
    concept = await store.resolve_concept(deps, topic, learning_goal)
    spec = await write_game(deps, topic, learning_goal, kid_view, grade)
    if not await store.strings_are_safe(deps, readable_text(spec)):
        raise ValueError("the game was flagged")
    spec.concept_id = concept or NO_CONCEPT
    return spec, concept


async def build_game(deps: Deps, kid_id: str, creation_id: str, topic: str, learning_goal: str, grade: Grade) -> Creation:
    """Never raises. The game is ready when its spec is, else the sky game stands in. With the studio agent on,
    its brand-new game is the one she plays, and the template waits as its stand-in."""
    try:
        spec, concept = await asyncio.wait_for(_make(deps, kid_id, topic, learning_goal, grade), GAME_DEADLINE_S)
        status = "ready"
    except Exception as e:  # includes the deadline's TimeoutError
        log.warning("game %s falls back: %s", creation_id, type(e).__name__)
        spec, concept, status = SKY_GAME, SKY_GAME.concept_id, "fallback"
    creation = Creation(id=creation_id, kind="game", status=status, game=spec)
    store.save(creation)
    meta = store.load_meta(creation_id)
    store.save_meta(creation_id, meta.model_copy(update={"concept_id": concept}))
    if studio_pro.directing():
        store.save(creation.model_copy(update={"status": "pending"}))  # being built: not in My creations yet
        creation = await build_brand_new(deps, kid_id, creation, topic, learning_goal)
    store.publish(deps, kid_id, CreationReadyEvent, "game", creation_id=creation_id, status=creation.status)
    return creation


async def build_brand_new(
    deps: Deps, kid_id: str, template: Creation, topic: str, learning_goal: str, *, agent: studio_pro.StudioAgent | None = None
) -> Creation:
    """Kite's own game is the one she plays: the studio agent (Claude Code on Opus 5.5) builds a brand-new game
    about her topic under the same creation. The template waits as its stand-in, and plays if the page doesn't
    come back. If the template fell back to the sky game, the agent's game is the one about her topic."""
    html = await studio_pro.make_page(
        deps, kid_id, template.id, "game", studio_pro.request_for(deps, kid_id, template.id, topic, learning_goal),
        lambda page: studio_pro.inject(page, "KITE_SOUNDS", studio_pro.GAME_SOUNDS), agent=agent,
    )
    if html:
        return store.take_page(template.id, "game", html)
    store.save(template)  # the template game is hers after all
    return template
