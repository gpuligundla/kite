"""Writes the cached fallback story in kite_brain/studio/fallback_story/: a hand-written fun story that
suits both day and bedtime. Without --voice it is text only, and the player turns its pages on a
reading clock. With --voice, ElevenLabs narrates it and makes its sound effects through the same code
a real story uses (needs the brain's .env).
Run from brain/: uv run python -m scripts.make_fallback_story [--voice]"""

import asyncio
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from kite_brain import studio_pro
from kite_brain.config import get_settings
from kite_brain.contract import Creation, Storybook
from kite_brain.studio import story
from kite_brain.voice import ElevenTts

GRADE = 3  # Kite's 3-5 voice: the middle of the range a fallback can reach

DAY = {"sky": "#8fd3f4", "ground": "#7cc576", "time_of_day": "day"}
EVENING = {"sky": "#f6b37f", "ground": "#6aa865", "time_of_day": "evening"}
NIGHT = {"sky": "#1b2a5a", "ground": "#2e4a3a", "time_of_day": "night"}


def kite(text: str) -> dict:
    return {"speaker": "Kite", "voice": "kite", "text": text}


def cue(prompt: str, word: str, line: int = 0, seconds: float = 1.5) -> dict:
    return {"prompt": prompt, "line": line, "word": word, "seconds": seconds}


STORYBOOK = Storybook.model_validate({
    "title": "Pip wants to fly",
    "mode": "story",
    "purpose": "fun",
    "pages": [
        {
            "background": "forest", "palette": DAY,
            "actors": [{"sprite": "frog", "name": "Pip", "entrance": "pop", "motion": "bounce"}],
            "lines": [kite("[excited] Down by the pond lived a little frog named Pip. Pip could hop higher than anyone."),
                      kite("But Pip had one big wish. Pip wanted to fly!")],
            "sounds": [cue("a cartoon boing for a springy little jump", "hop")],
        },
        {
            "background": "forest", "palette": DAY,
            "actors": [{"sprite": "frog", "name": "Pip", "entrance": "left", "motion": "bounce"},
                       {"sprite": "bird", "entrance": "right", "motion": "float"}],
            "lines": [kite("One morning, a bird landed beside Pip. Can you teach me to fly, asked Pip?"),
                      kite("[laughs] The bird gave a friendly chirp. Flying takes wings, she said, but let's try something fun.")],
            "sounds": [cue("a small songbird chirping twice", "chirp", line=1)],
        },
        {
            "background": "sky", "palette": DAY,
            "actors": [{"sprite": "frog", "name": "Pip", "entrance": "pop", "motion": "float"},
                       {"sprite": "butterfly", "entrance": "right", "motion": "float"}],
            "lines": [kite("Pip hopped onto a big leaf, and the wind lifted it up, up, up!"),
                      kite("[gasps] Pip floated over the pond like a tiny green kite.")],
            "sounds": [cue("a gentle gust of wind rustling leaves", "wind", seconds=2.0)],
        },
        {
            "background": "sky", "palette": EVENING,
            "actors": [{"sprite": "frog", "name": "Pip", "entrance": "left", "motion": "float"},
                       {"sprite": "rainbow", "entrance": "pop", "motion": "float"}],
            "lines": [kite("From up high, Pip saw the trees, the flowers and a rainbow over the hill."),
                      kite("[laughs] I'm flying, Pip shouted, and the bird flew right beside him.")],
            "sounds": [],
        },
        {
            "background": "forest", "palette": NIGHT,
            "actors": [{"sprite": "frog", "name": "Pip", "entrance": "pop", "motion": "bounce"},
                       {"sprite": "moon", "entrance": "pop", "motion": "float"}],
            "lines": [kite("The leaf drifted down softly, and Pip landed on the pond with a happy splash."),
                      kite("[softly] That night, Pip looked up at the moon and smiled. Some wishes come true in surprising ways.")],
            "sounds": [cue("a small soft water splash", "splash")],
        },
    ],
})


def main(voice: bool) -> None:
    out = story.FALLBACK_DIR
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.mp3"):
        old.unlink()
    audio, timings = {}, {}
    if voice:
        deps = SimpleNamespace(
            tts=ElevenTts(get_settings().ELEVENLABS_API_KEY), bus=SimpleNamespace(publish=lambda e: None),
            clock=lambda: datetime.now(timezone.utc),
        )
        with tempfile.TemporaryDirectory() as tmp, patch.object(studio_pro, "CREATIONS_DIR", Path(tmp)):
            audio, timings = asyncio.run(story._voice(deps, "fallback", "fallback", STORYBOOK, GRADE))
            for name in audio.values():
                shutil.copy(Path(tmp) / "fallback" / name, out / name)
    creation = Creation(id="fallback", kind="story", status="fallback", storybook=STORYBOOK, audio=audio, timings=timings)
    (out / "creation.json").write_text(creation.model_dump_json(indent=2) + "\n")
    print(f"wrote {out} with {len(audio)} audio files")


if __name__ == "__main__":
    main("--voice" in sys.argv)
