# Wiring the web app to the brain's studio and parent routes

Branch `integrate` has the real brain routes, `packages/movie`, `packages/games`, and regenerated
types in `packages/client/src/contract.d.ts`. Everything below is live against `uvicorn` on that branch.

## Setup

- `next.config`: `transpilePackages: ["@kite/movie", "@kite/games"]`.
- Creation files come back as root-relative paths (`/creations/{id}/files/0-0.mp3`). Add a Next rewrite
  of `/creations/:path*` to the brain so they load from the web origin. These GETs need no token: the
  32-hex creation id is the capability.

## Movies (Tasks 13 and 19)

A movie starts from a turn (the brain's tool call) or from `POST /creations {kind: "movie", topic, learning_goal}`
with an `os` or `handheld` token. Either way the stream carries:

- `creation.progress {creation_id, kind, step, steps_total}` while it narrates,
- `creation.ready {creation_id, kind, status: "ready" | "fallback"}` when it can play,
- `creation.video {creation_id, video_url}` later, once the MP4 is rendered. A fallback has its MP4 at once.

On `creation.ready` with `kind: "movie"`, fetch `GET /creations/{id}` and play it:

```tsx
import { Player } from "@remotion/player";
import { KiteMovie, buildTimeline, MOVIE_FPS, MOVIE_WIDTH, MOVIE_HEIGHT } from "@kite/movie";

const { sprites, ...creation } = await (await fetch(`/creations/${id}`)).json();
<Player component={KiteMovie} inputProps={{ creation, sprites }}
  durationInFrames={buildTimeline(creation).durationInFrames} fps={MOVIE_FPS}
  compositionWidth={MOVIE_WIDTH} compositionHeight={MOVIE_HEIGHT} controls style={{ width: "100%" }} />
```

Pass `sprites` exactly as the brain sends it (slug to raw `<svg>` markup). The player turns it into images.
The check question (`creation.storyboard.check`) shows after the last scene. Send the kid's pick with
`POST /creations/{id}/answer {choice}` (os or handheld token) and get back `{correct, correct_index, recorded}`.

### Director's cut

After a template movie is ready, the brain asks the Foundry studio agent (Claude Code on Opus 5.5) for a
hand-animated version of the same story. It arrives minutes later as its own creation (kind `movie`, with
`html_url` and no `storyboard`), carrying the real narration and a soft music bed. `CreationCard` plays any
creation with `html_url` in `<iframe sandbox="allow-scripts">` behind a play button, labelled "Kite's special
version". A director's cut that doesn't finish leaves no card; the template movie stays.

## Template games (Task 27)

On `creation.ready` with `kind: "game"`, fetch `GET /creations/{id}` and mount `creation.game`:

```ts
import { mountGame } from "@kite/games";
const stop = mountGame(canvas, creation.game, (r) => post(`/creations/${id}/result`, r), sprites);
// call stop() on unmount; the canvas is 960 x 600
```

`r` is `{correct, total}`; post it with the os or handheld token. The brain turns it into learning evidence once per game.

## Brand-new games (Task 32)

Under a template game, a "Build me a brand-new one!" button sends
`POST /kids/{kid}/games/custom {topic, learning_goal}` (os or handheld token) and gets back `{creation_id}`.
Show the `creation.progress` steps. Building takes 1 to 3 minutes. Then `creation.ready`:

- `status: "ready"`: `GET /creations/{id}` has `html_url`. Render it in
  `<iframe sandbox="allow-scripts" src={html_url}>`. The brain serves it with a CSP that blocks all network access.
- `status: "fallback"`: keep the template game on screen and say Kite will try again another time.

## Parent page (Task 21)

All need a `parent` token (Bearer or the `kite_token` cookie) for that kid.

| Route | Returns |
|---|---|
| `GET /kids/{kid}/dashboard?grade=g` | `DashboardView`. Omit `grade` for the current grade; the grade slider passes it. |
| `PUT /families/{family}/policy/{topic} {action}` | `topic` is one of death, religion, bodies, war, divorce. `action` is `answer`, `answer_and_tell` or `ask_parent`. |
| `GET /kids/{kid}/contacts` | `[{name, phone}]` |
| `GET /kids/{kid}/movies` | rendered movies, newest first (`Creation[]` with `video_url`) |
| `GET /trust` | `{scorecard, readability}` for the Trust tab (404 until the night shift has run) |
| `GET /kids/{kid}/dashboard` → `how_she_learns` | optional `{source: share}`, e.g. `{"teach_back": 1.0, "game": 0.5}`: of the concepts first met that way, the share now at got it or better |

Every dashboard, contacts and movies read writes an access receipt, so don't poll them. Refresh on
`alert` events from the parent stream instead.

## Counselor page (Task 26)

`GET /counselor/alerts` with a `counselor` token returns `[{alert_id, kinds, at, excerpt}]`, newest first,
for the kid that counselor device is bound to. Only counselor-routed alerts (abuse) appear; bullying and
SOS go to the parent. Each excerpt returned is recorded as a receipt.

## "What Kite remembers" (Task 28)

`GET /kids/{kid}/kid-view` with an `os` or `handheld` token returns `{interests, characters, moments, deep_topics}`
as plain strings. It never has levels or scores. There is no per-item forget yet: the kid says "forget that"
in a turn, Kite replies "Okay, I forgot that.", and the stream's `routed` event has `route: "forget"`.
Refetch the kid view after that event.
