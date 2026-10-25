# Kite web: design and build rules

Read this whole file before writing UI. It is the shared brief for everyone building `apps/web`.

## Who it's for

- **The kid screen (`/os`)** is used by one child, aged 5 to 18. It must feel made for their age: a first grader and a tenth grader both feel it's theirs.
- **The grown-up view (`/parent`, `/counselor`)** is used by a parent or a school counselor. It must feel calm, trustworthy and quick to read.

The two never share a screen. On stage they are two browser profiles side by side.

## Direction

**The kite is the only ornament.** Kite, the companion, is a four-panel diamond kite (`components/kit/KiteMark.tsx`) whose tail waves while it speaks. The hold-to-talk button shares the diamond. Everything else stays plain: no gradient washes, no decorative blobs, no identical card grids.

Colors come from ripstop kite nylon, flown against the sky. The tokens live in `app/globals.css`:

| Token | Hex | Use |
|---|---|---|
| `--ink` | #1d2b53 | text, outlines |
| `--sky` / `--band-bg` | #cdebf7 and band variants | kid page background |
| `--kite-red` | #e8443a | the one main action (talk, send) |
| `--kite-yellow` | #ffc93c | highlight, the reading-level badge |
| `--tail-teal` | #12a39a | success, "got it" |
| `--sky-deep` | #8fcde8 | secondary panels on the kid side |
| `--mist` | #f3f5f9 | grown-up background |

On the grown-up side, kite colors appear only as data colors and actions. Never as decoration.

**Type.**
- Atkinson Hyperlegible (`--font-body`) is for reading. It was designed for legibility, which suits kids learning to read.
- Bricolage Grotesque (`--font-display`) is for headings and Kite's name.
- Avoid all-caps labels, eyebrow labels over headings, and single-word color accents in headlines.

**Layout.**
- The kid screen is centered around Kite, with a dock at the bottom for talking and typing.
- The grown-up view is left-aligned, with hierarchy shown by size and order, not boxes. Line length stays under 80 characters.

## The kid screen grows up with the grade band

`data-band` on the kid page's root picks the band. It comes from `bandFor(grade)` in `lib/band.ts`, where the grade is `GET /kids/{kid}/me` or the grade slider's value. In the demo, sliding from grade 1 to grade 10 visibly changes the screen.

| Band | Feel | Text | Touch target | Corners | Spring bounce | Sounds |
|---|---|---|---|---|---|---|
| `k2` (K-2) | big, bouncy, picture-first | `--kid-text` ≈ 26px | 76px | 30px | 0.3 | all |
| `g35` (3-5) | playful, confident | ≈ 21px | 64px | 24px | 0.2 | all |
| `g68` (6-8) | relaxed, less babyish | ≈ 19px | 54px | 18px | 0.1 | confirmations and celebrations |
| `g912` (9-12) | clean, almost a grown-up app | 17px | 48px | 12px | 0 | confirmations only |

Use the CSS variables (`--kid-text`, `--target`, `--radius-kid`, `--kite-size`) and `SPRING[band]` from `lib/band.ts`. Don't hard-code per-band numbers.

## Motion

These follow Emil Kowalski's animation rules.

- **Decide by frequency first.** Typing, keyboard shortcuts and scrolling get no animation. Sending a message and a new answer bubble get a short, subtle entrance. Celebrations are rare.
- **The delight budget.** Celebration (motion plus the `cheer` sound) is only for:
  - finishing a teach-back (`answer.done` with route `teach`). Celebrate the teaching, never the grade. `taught` is parent-only by design (`KID_EVENT_TYPES` in `contract.py`), and Kite's spoken feedback already tells the kid how they did.
  - a check question answered right
  - a game finished
  - a movie or game becoming ready

  Nothing else celebrates.
- **Curves and durations.**
  - Enter and exit use `var(--ease-out)`. Movement on screen uses `var(--ease-in-out)`. Never use `ease-in`.
  - Durations: `--dur-press` 140ms, `--dur-pop` 200ms, `--dur-panel` 260ms. UI motion stays under 300ms. Only the band change (`--dur-band`) is slower.
- **Properties.** Animate `transform` and `opacity` only. Never `scale(0)`; start from `scale(0.95)` with `opacity: 0`. Stagger lists by 30-80ms.
- **Tools.** Use CSS transitions for hover, press and state. Use Motion (`motion/react`, installed) for springs, exits and layout. In Motion, pass a full `transform` string, not the `x`/`y`/`scale` shorthands.
- **Accessibility.** Gate hover motion with `@media (hover: hover) and (pointer: fine)`. Reduced motion means gentler, not none: keep opacity changes and drop movement. `useReducedMotion()` exists in Motion.

## Sound

`lib/sound.ts` has `playSound(name)`. The sounds are ElevenLabs sound effects, loudness-matched at -22 LUFS, so they sit under Kite's voice.

| Sound | When |
|---|---|
| `send` | the kid sends a typed message |
| `listen` | recording starts (hold-to-talk pressed, teach-back started) |
| `whoosh` | Kite starts a new answer, or a panel opens |
| `correct` | check question right |
| `oops` | check question wrong, or a recoverable error. Gentle, never harsh. |
| `ready` | a movie or game is ready |
| `cheer` | the delight moments listed above |
| `sent` | SOS delivered, a grown-up confirmation |

- Call `setSoundBand(band)` when the band changes.
- Call `setVoiceActive(true/false)` around Kite's spoken sentences, so UI sounds never talk over the voice.
- Give the kid screen a visible mute toggle (`setMuted`).

## Words

- **Kid side.** Short, warm, second person ("Hold to talk", "Teach Kite something", "Your movie is ready"). Name things the way a kid would.
- **Never show levels, scores, grades of mastery or "skills" on the kid side.** This is a core product rule, and the brain enforces it too.
- **Grown-up side.** Plain and specific ("Maya asked about death on Tuesday", "Strength: dinosaurs"). Sentence case.
- **Errors.** Say what happened and what to do next. They never apologize.

## Engineering rules

- **Pages that talk to the brain are client components.** Use `useBrain(device)`, `useTalk(brain)` and `useBrainEvents(brain, fn)` from `lib/brain.ts`, and `brain.get/post/put` for any route. Never call `fetch("/brain/...")` by hand. Routes are listed in `docs/web-wiring.md`.
- **Creations.** Fold `creation.*` events with `reduceCreations` from `lib/creations.ts`. Render each one with `<CreationCard brain creation />` from `components/creations/CreationCard.tsx`. Those props are final.
- **Browser-only libraries.** `@kite/movie` (Remotion player) and `@kite/games` (KAPLAY) touch the browser at import. Load them with `next/dynamic(() => import(...), { ssr: false })`.
- **Don't edit shared files.** These are lead-only:
  - `package.json` and `next.config.ts`
  - `tsconfig.json`
  - `app/layout.tsx` and `app/globals.css`
  - `components/kit/*`
  - `lib/*.ts`
  - anything under `packages/`

  If you need a dependency or a shared change, put it in your report instead.
- **Ownership:**
  - Kite OS: `app/os/page.tsx`, `app/os/OsScreen.tsx`, other `app/os/*.tsx` (except `remember/`), `components/os/*`
  - Creations: `components/creations/*`, `app/os/remember/*`, `app/dev/*`
  - Grown-up: `app/parent/*`, `app/counselor/*`, `components/parent/*`
- **Styling.** Use CSS Modules next to the component, built on the tokens above. No CSS framework.

## Verifying

- **The brain.** A real brain is already running at `http://localhost:8001`. Don't start or stop it. Each helper runs its own Next dev server: `BRAIN_URL=http://localhost:8001 npx next dev -p <your port>`.
- **Pairing.** Device tokens are in `/tmp/claude-1000/-home-gpuligundla-deerbrook-tmp/a7ebbef2-6497-428b-bfd0-4686419deadf/scratchpad/tokens.env`, as `OS_TOKEN`, `PARENT_TOKEN` and `COUNSELOR_TOKEN`. Source it into the environment and never print it. Pair a browser with `/setup?token=$OS_TOKEN&to=os`, or `to=parent`, `to=counselor`, `to=handheld`.
- **Playwright.** It's installed in the repo. Use one browser context per device. For hold-to-talk, launch Chromium with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<a .wav>`.
- **Look at it.** Screenshot every screen at 1280×800, and at 390×844 for `?device=handheld`. Review the screenshots, fix what looks off, and keep the final ones.
- **Keep real model calls modest.** Each turn calls Claude and ElevenLabs, so stay under about 15 live turns per helper.
