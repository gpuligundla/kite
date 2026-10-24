import sqlite3
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Literal

import numpy as np

from kite_brain.catalog import Catalog
from kite_brain.contract import AlertKind
from kite_brain.crypto import FamilyKeys

if TYPE_CHECKING:
    from kite_brain.bus import EventBus
    from kite_brain.decide import Decisions
    from kite_brain.llm import FoundryLlm
    from kite_brain.questions import Question
    from kite_brain.safety import AzureSafety
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
    """Everything a turn needs, built once at startup. `decide` has its backends and
    timeout already bound with functools.partial."""

    conn: sqlite3.Connection
    keys: FamilyKeys
    bus: "EventBus"
    catalog: Catalog
    decide: Callable[[str, list["Question"]], Awaitable["Decisions"]]
    llm: "FoundryLlm"
    embed: Callable[[list[str]], Awaitable[np.ndarray]]
    safety: "AzureSafety"
    stt: "ScribeStt"
    tts: "ElevenTts"
    clock: Callable[[], datetime]
