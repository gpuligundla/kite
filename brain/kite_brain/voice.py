"""Voices and speech. Every voice id comes from KITE_VOICES and must be on the allowlist."""

import base64
import io
import json
import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Literal, get_args

from elevenlabs import AsyncElevenLabs, VoiceSettings

from kite_brain.config import get_settings
from kite_brain.contract import CharacterVoiceName, Word
from kite_brain.policy import BANDS, Band

Situation = Literal[
    "answer", "homework_help", "explain", "big_question", "alert", "celebrate", "listen", "story"
]

FLASH = "eleven_flash_v2_5"
EXPRESSIVE = "eleven_v3"
SCRIBE = "scribe_v2"
MP3 = "mp3_44100_128"

# Persona hints for the storyboard writer, which picks speakers by name.
CHARACTER_VOICES: dict[str, str] = {
    "narrator": "calm storyteller who narrates",
    "professor": "wise, slightly funny teacher",
    "explorer": "bold, excited adventurer",
    "storyteller": "warm, dramatic fairy-tale voice",
    "robot_buddy": "cheerful, bouncy helper robot",
}
assert set(CHARACTER_VOICES) == set(get_args(CharacterVoiceName))


@dataclass(frozen=True)
class VoiceSpec:
    voice_id: str
    model_id: str
    settings: dict


@dataclass(frozen=True)
class Voices:
    bands: dict[str, str]
    characters: dict[str, str]


def load_voices(raw: str) -> Voices:
    """KITE_VOICES is {"bands": {"K-2": id, "3-5": id, "6-8": id, "9-12": id},
    "characters": {"narrator": id, "professor": id, "explorer": id, "storyteller": id,
    "robot_buddy": id}}. Every key is required."""
    data = json.loads(raw)
    voices = Voices(data.get("bands", {}), data.get("characters", {}))
    for names, ids, what in (
        ([b.name for b in BANDS], voices.bands, "bands"),
        (list(CHARACTER_VOICES), voices.characters, "characters"),
    ):
        missing = [n for n in names if not ids.get(n)]
        if missing:
            raise ValueError(f"KITE_VOICES.{what} is missing {missing}")
    return voices


@lru_cache
def _voices(raw: str) -> Voices:
    return load_voices(raw)


def current_voices() -> Voices:
    return _voices(get_settings().KITE_VOICES)


def allowed_voice_ids() -> set[str]:
    v = current_voices()
    return set(v.bands.values()) | set(v.characters.values())


# Younger is slower and more expressive, older is natural speed and steadier.
BAND_SETTINGS: dict[str, dict] = {
    "K-2": {"speed": 0.9, "stability": 0.35, "style": 0.5},
    "3-5": {"speed": 0.95, "stability": 0.4, "style": 0.4},
    "6-8": {"speed": 1.0, "stability": 0.5, "style": 0.25},
    "9-12": {"speed": 1.0, "stability": 0.6, "style": 0.1},
}
# Situation tweaks over the band. Alert is slowest and steadiest, with no style.
SITUATION_TWEAKS: dict[str, dict] = {
    "answer": {},
    "homework_help": {"style": 0.4},
    "explain": {"speed": 0.95, "stability": 0.65},
    "big_question": {"speed": 0.9, "stability": 0.55, "style": 0.15},
    "alert": {"speed": 0.8, "stability": 0.9, "style": 0.0},
    "celebrate": {"stability": 0.3, "style": 0.7},
    "listen": {"speed": 0.92, "stability": 0.5, "style": 0.2},
    "story": {"stability": 0.5},  # v3 accepts stability 0.0, 0.5 or 1.0 only
}
SIMILARITY = 0.75


def voice_for(band: Band, situation: Situation) -> VoiceSpec:
    settings = {"similarity_boost": SIMILARITY, **BAND_SETTINGS[band.name], **SITUATION_TWEAKS[situation]}
    model = EXPRESSIVE if situation == "story" else FLASH
    return VoiceSpec(current_voices().bands[band.name], model, settings)


def character_spec(name: CharacterVoiceName) -> VoiceSpec:
    settings = {"stability": 0.5, "similarity_boost": SIMILARITY}
    return VoiceSpec(current_voices().characters[name], EXPRESSIVE, settings)


def words_from_alignment(chars: list[str], starts: list[float], ends: list[float]) -> list[Word]:
    """Group per-character times into words. Characters inside [audio tags] are skipped."""
    words: list[Word] = []
    text, start, end, depth = "", 0.0, 0.0, 0
    for ch, s, e in zip(chars, starts, ends, strict=True):
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth = max(depth - 1, 0)
        elif depth == 0 and not ch.isspace():
            if not text:
                start = s
            text, end = text + ch, e
        elif depth == 0 and text:
            words.append(Word(text=text, start=start, end=end))
            text = ""
    if text:
        words.append(Word(text=text, start=start, end=end))
    return words


class ElevenTts:
    def __init__(self, api_key: str):
        self._client = AsyncElevenLabs(api_key=api_key)

    async def speak(self, text: str, spec: VoiceSpec) -> bytes:
        """Live answers. Flash, because voice_for gives Flash to every situation but story."""
        chunks = self._client.text_to_speech.convert(
            spec.voice_id,
            text=text,
            model_id=spec.model_id,
            voice_settings=VoiceSettings(**spec.settings),
            output_format=MP3,
        )
        return b"".join([c async for c in chunks])

    async def speak_timed(self, text: str, spec: VoiceSpec) -> tuple[bytes, list[Word]]:
        """Movies. Always the expressive model, with word times from the alignment."""
        r = await self._client.text_to_speech.convert_with_timestamps(
            spec.voice_id,
            text=text,
            model_id=EXPRESSIVE,
            voice_settings=VoiceSettings(**spec.settings),
            output_format=MP3,
        )
        a = r.alignment
        words = (
            words_from_alignment(a.characters, a.character_start_times_seconds, a.character_end_times_seconds)
            if a
            else []
        )
        return base64.b64decode(r.audio_base_64), words


class ScribeStt:
    def __init__(self, api_key: str):
        self._client = AsyncElevenLabs(api_key=api_key)

    async def transcribe(self, audio: bytes, mime: str) -> str:
        r = await self._client.speech_to_text.convert(
            model_id=SCRIBE, file=("audio", io.BytesIO(audio), mime), tag_audio_events=False
        )
        return re.sub(r"\s+", " ", r.text).strip()
