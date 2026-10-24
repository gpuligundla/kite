# @kite/movie

One Remotion composition, `KiteMovie`, that draws a Kite `Creation` (storyboard, narration audio, word timings).

- Live: `@remotion/player` plays `KiteMovie` in the browser.
- File: `node packages/movie/render.mjs <creation.json> [--still <frame>]` writes `movie.mp4` (or `still.png`) next to the JSON. The first run downloads Remotion's headless Chrome (about 100 MB).
- Check: `npm -w packages/movie run check` (timeline math) and `npm -w packages/movie run typecheck`.
- Sample: `node packages/movie/sample/make-sample.mjs`, then render `packages/movie/sample/creation.json`.

## Data conventions

- `creation.audio` and `creation.timings` are keyed `"<sceneIndex>-<lineIndex>"` (for example `"1-0"`). Word times are seconds from the start of that line's audio.
- A line lasts as long as its last word. With no timings it is estimated at 0.35 s per word.
- Each scene is followed by a 0.5 s gap. The check question appears in the last gap and holds 0.5 s longer.
- Sprites are looked up by slug in the `sprites` prop (slug to `data:` URL). Unknown slugs get a flat generated badge. `render.mjs` also accepts a top-level `sprites` map in creation.json (data URL, raw `<svg>` markup, or a file path).
- Audio URLs starting with `http`, `data:` or `/` play as they are. Anything else is a file in the bundle's public dir; `render.mjs` copies local files there.

## License

Remotion is free for individuals and very small teams, and needs a paid company license beyond that. Confirm the current terms at https://www.remotion.dev/license before shipping this commercially.
