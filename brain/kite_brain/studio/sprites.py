"""The shared sprite set (spec section 9): vendored Fluent Emoji "Flat" SVGs, looked up by name.
Every sprite reaches a page as a data: image URL, so a script inside an SVG never runs."""

import base64
from functools import cache
from pathlib import Path

SPRITE_DIR = Path(__file__).with_name("sprites")
INLINE_SVG_MAX_BYTES = 4096
ALIASES = {"rexy": "trex"}  # a kid's favorite character is a sprite name


@cache
def sprite_names() -> frozenset[str]:
    return frozenset(p.stem for p in SPRITE_DIR.glob("*.svg"))


def canonical(name: str) -> str:
    """The set's own name for `name`. KeyError for anything outside the set."""
    name = ALIASES.get(name, name)
    if name not in sprite_names():
        raise KeyError(f"unknown sprite {name!r}")
    return name


def sprite_svg(name: str) -> str:
    return (SPRITE_DIR / f"{canonical(name)}.svg").read_text()


def svg_data_url(svg: str) -> str:
    """The only way an SVG becomes something a page shows. Claude's own drawings are capped at 4 KB."""
    if len(svg.encode()) > INLINE_SVG_MAX_BYTES:
        raise ValueError("an inline SVG is at most 4 KB")
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()
