"""Writes the cached fallback movie in kite_brain/studio/fallback/: a hand-written sky-is-blue
storyboard, word timings estimated at a steady pace, and silent MP3s (needs ffmpeg). Nothing here
calls ElevenLabs, so the fallback has captions and no voice until real narration replaces it.
Run from brain/: uv run python -m scripts.make_fallback_movie"""

import json
import subprocess
from pathlib import Path

from kite_brain.contract import Creation, Storyboard, Word
from kite_brain.studio import store
from kite_brain.studio.storyboard import narration_lines

OUT = Path("kite_brain/studio/fallback")
SECONDS_PER_WORD = 0.38
LEAD_IN_S = 0.3

STORYBOARD = Storyboard.model_validate({
    "title": "Why the sky is blue",
    "scenes": [
        {
            "background": "sky", "camera": "still",
            "palette": {"sky": "#7ec8f5", "ground": "#8fd18b", "time_of_day": "day"},
            "actors": [{"sprite": "sun", "entrance": "pop", "motion": "float"},
                       {"sprite": "cloud", "entrance": "left", "motion": "float"}],
            "lines": [
                {"speaker": "Narrator", "voice": "narrator", "text": "Look up at the sky on a sunny day. Why is it blue?"},
                {"speaker": "Professor", "voice": "professor", "text": "Sunlight looks white, but it hides every color of the rainbow inside."},
            ],
        },
        {
            "background": "sky", "camera": "pan",
            "palette": {"sky": "#5aa9e6", "ground": "#8fd18b", "time_of_day": "day"},
            "actors": [{"sprite": "rainbow", "entrance": "pop", "motion": "float"},
                       {"sprite": "sun", "entrance": "right", "motion": "bounce"}],
            "lines": [
                {"speaker": "Explorer", "voice": "explorer", "text": "When sunlight zooms into our air, it bumps into tiny bits of gas!"},
                {"speaker": "Professor", "voice": "professor", "text": "Blue light is the bounciest color, so it scatters all across the sky."},
            ],
        },
        {
            "background": "sky", "camera": "zoom",
            "palette": {"sky": "#4a90d9", "ground": "#8fd18b", "time_of_day": "day"},
            "actors": [{"sprite": "kid", "entrance": "left", "motion": "bounce"},
                       {"sprite": "robot", "entrance": "right", "motion": "bounce"}],
            "lines": [
                {"speaker": "Narrator", "voice": "narrator", "text": "So blue light is bouncing toward your eyes from every part of the sky."},
                {"speaker": "Robot Buddy", "voice": "robot_buddy", "text": "That is why the sky is blue. Pretty cool, right?"},
            ],
        },
    ],
    "check": {
        "question": "Why does the sky look blue?",
        "choices": ["Blue light bounces around the most in our air", "The ocean paints it blue", "The sun is a blue star"],
        "correct_index": 0,
        "concept_id": "light_sky_blue",
    },
})


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    audio, timings = {}, {}
    for key, text in narration_lines(STORYBOARD):
        words, clock = [], LEAD_IN_S
        for word in text.split():
            words.append(Word(text=word, start=clock, end=clock + SECONDS_PER_WORD))
            clock += SECONDS_PER_WORD
        name = f"{key}.mp3"
        subprocess.run(
            ["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=22050:cl=mono",
             "-t", f"{clock + 0.2:.2f}", "-b:a", "16k", str(OUT / name)],
            check=True,
        )
        audio[key], timings[key] = name, words
    creation = Creation(id="fallback", kind="movie", status="fallback", storyboard=STORYBOARD, audio=audio, timings=timings)
    # Same shape as studio.store.save, so render.mjs finds the actors' art.
    data = creation.model_dump(mode="json") | {"sprites": store.sprites_for(creation)}
    (OUT / "creation.json").write_text(json.dumps(data, indent=2))
    print(f"wrote {len(audio)} silent lines to {OUT}")


if __name__ == "__main__":
    main()
