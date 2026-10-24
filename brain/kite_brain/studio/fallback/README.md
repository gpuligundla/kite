# Fallback movie (hand-written, silent)

This is the cached "why the sky is blue" movie that plays when a real movie misses its 45 s
deadline or fails. It is **not** ElevenLabs output.

- The storyboard is written by hand in `brain/scripts/make_fallback_movie.py`.
- Word timings are estimated at 0.38 s a word, not aligned from audio.
- The `*.mp3` files are silent (made with ffmpeg), so captions play with no voice.
- Regenerate it with `uv run python -m scripts.make_fallback_movie` from `brain/`.

`movie.mp4` is rendered from `creation.json` by `packages/movie`. After regenerating, render it again
from `brain/` with `node ../packages/movie/render.mjs kite_brain/studio/fallback/creation.json`.
A fallback creation copies it and publishes `creation.video` right away.
