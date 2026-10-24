"""Cut the answer into sentences and speak them in order, off the Claude stream."""

import asyncio
import base64
import logging
import re
from collections.abc import AsyncIterator, Callable

from kite_brain.deps import Deps
from kite_brain.turn.route import FALLBACK
from kite_brain.voice import VoiceSpec

log = logging.getLogger(__name__)

_SENTENCE_END = re.compile(r"(.*?[.!?]+[\"')\]]*)\s+", re.S)
END = None  # queue sentinel

Publish = Callable[[int, str, str], None]  # (index, text, audio_b64)


class SentenceSplitter:
    def __init__(self) -> None:
        self._buffer = ""

    def feed(self, delta: str) -> list[str]:
        self._buffer += delta
        out = []
        while m := _SENTENCE_END.match(self._buffer):
            if sentence := m.group(1).strip():
                out.append(sentence)
            self._buffer = self._buffer[m.end():]
        return out

    def flush(self) -> list[str]:
        rest, self._buffer = self._buffer.strip(), ""
        return [rest] if rest else []


async def audio_b64(deps: Deps, text: str, spec: VoiceSpec | None) -> str:
    """Spoken MP3, or empty when there is no voice: the text still reaches the kid."""
    if spec is None:
        return ""
    try:
        return base64.b64encode(await deps.tts.speak(text, spec)).decode()
    except Exception:
        log.warning("tts failed", exc_info=True)
        return ""


async def speak_sentences(
    sentences: AsyncIterator[str], deps: Deps, spec: VoiceSpec | None, publish: Publish, moderate: bool = True
) -> str:
    """Speak each sentence in order and return the text the kid actually heard. A sentence
    that fails output safety, or whose check fails, stops the answer and speaks FALLBACK."""
    spoken: list[str] = []
    async for text in sentences:
        flagged = False
        if moderate:
            try:
                flagged = not await deps.safety.check_output(text)
            except Exception:
                log.warning("output safety check failed", exc_info=True)
                flagged = True
        if flagged:
            spoken, text = [], FALLBACK
        publish(len(spoken), text, await audio_b64(deps, text, spec))
        spoken.append(text)
        if flagged:
            break
    return " ".join(spoken)


async def drain(queue: asyncio.Queue) -> AsyncIterator[str]:
    while (item := await queue.get()) is not END:
        yield item
