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
# Kite's words are spoken, so markup is never valid. The prompt forbids it; this catches what slips through.
_MARKUP = re.compile(r"\*\*|__|`|^\s*(?:[-*•]\s+|#{1,6}\s+)+", re.M)


_INLINE_BULLET = re.compile(r"(?<=[.!?:])\s+[-*•]\s+")


def plain(text: str) -> str:
    """Spoken-safe text: no emphasis marks, headings or list markers, on one line."""
    return re.sub(r"\s*\n\s*", " ", _MARKUP.sub("", _INLINE_BULLET.sub(" ", text))).strip()
END = None  # queue sentinel

Publish = Callable[[int, str, str], None]  # (index, text, audio_b64)


class SentenceSplitter:
    def __init__(self) -> None:
        self._buffer = ""

    def feed(self, delta: str) -> list[str]:
        self._buffer += delta
        out = []
        while m := _SENTENCE_END.match(self._buffer):
            if sentence := plain(m.group(1)):
                out.append(sentence)
            self._buffer = self._buffer[m.end():]
        return out

    def flush(self) -> list[str]:
        rest, self._buffer = plain(self._buffer), ""
        return [rest] if rest else []


async def audio_b64(deps: Deps, text: str, spec: VoiceSpec | None) -> str:
    """Spoken MP3, or empty when there is no voice: the text still reaches the kid."""
    if spec is None:
        return ""
    try:
        return base64.b64encode(await deps.tts.speak(text, spec)).decode()
    except Exception as e:  # the message may echo the text, so only the type is logged
        log.warning("tts failed (%s)", type(e).__name__)
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
            except Exception as e:
                log.warning("output safety check failed (%s)", type(e).__name__)
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
