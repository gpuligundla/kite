import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any, Literal

from kite_brain.catalog import Catalog
from kite_brain.contract import AlertKind
from kite_brain.crypto import FamilyKeys

if TYPE_CHECKING:
    from kite_brain.bus import EventBus
    from kite_brain.voice import ElevenTts, ScribeStt


@dataclass
class LlmRequest:
    system: str
    context: str
    messages: list[dict[str, str]]
    image: bytes | None = None
    tools: bool = False


@dataclass
class ToolCall:
    name: Literal["make_movie", "make_game"]
    topic: str
    learning_goal: str


@dataclass
class SafetyResult:
    kinds: set[AlertKind]
    jailbreak: bool = False


@dataclass
class Deps:
    """Everything a turn needs, built once at startup. The clients are the concrete
    classes from the modules that define them; llm, embed, safety and decide are typed
    loosely until those modules land (Tasks 5, 7, 9 and 10)."""

    conn: sqlite3.Connection
    keys: FamilyKeys
    bus: "EventBus"
    catalog: Catalog
    decide: Callable[..., Any]
    llm: Any
    embed: Callable[[list[str]], Any]
    safety: Any
    stt: "ScribeStt"
    tts: "ElevenTts"
    clock: Callable[[], datetime]
