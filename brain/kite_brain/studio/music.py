"""A soft music bed under a director's cut, from ElevenLabs Music. Optional: no key or a failed call
only means a movie without music."""

import logging

from elevenlabs import AsyncElevenLabs

from kite_brain.config import get_settings
from kite_brain.contract import Grade
from kite_brain.policy import band_for

log = logging.getLogger(__name__)

MOODS = {
    "K-2": "Bouncy and playful, with ukulele and glockenspiel.",
    "3-5": "Bright and curious, with marimba and light pizzicato strings.",
    "6-8": "Clean and modern, with soft synth plucks and pads.",
    "9-12": "Sleek and cinematic, with warm ambient pads and a slow pulse.",
}
PROMPT = (
    "Soft instrumental underscore for a kids' {what} about {topic}. {mood} "
    "Low, steady and calm under a narrator's voice. No vocals, no big drums, no sudden changes."
)


async def music_bed(topic: str, grade: Grade, seconds: float, mood: str | None = None) -> bytes | None:
    """An MP3 about `seconds` long, or None. A `mood` makes it a story's bed instead of an explainer's."""
    key = get_settings().ELEVENLABS_API_KEY
    if not key:
        return None
    try:
        chunks = AsyncElevenLabs(api_key=key).music.compose(
            prompt=PROMPT.format(
                topic=topic, what="story" if mood else "science explainer", mood=mood or MOODS[band_for(grade).name]
            ),
            music_length_ms=int(min(max(seconds, 10), 120) * 1000), force_instrumental=True, output_format="mp3_44100_64",
        )
        return b"".join([c async for c in chunks])
    except Exception as e:
        log.warning("music bed failed (%s)", type(e).__name__)
        return None
