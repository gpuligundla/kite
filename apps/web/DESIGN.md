# Kite web: design and build rules

Read this whole file before writing UI. It is the shared brief for everyone building `apps/web`.

## Who it's for

- **The kid screen (`/os`)** is used by one child, aged 5 to 18. It must feel made for their age: a first grader and a tenth grader both feel it's theirs.
- **The grown-up view (`/parent`, `/counselor`)** is used by a parent or a school counselor. It must feel calm, trustworthy and rich: everything Kite knows that they're allowed to see, organized in tabs.

The two never share a screen. On stage they are two browser profiles side by side.

## Direction (v2: the living sky)

The first version was calm to a fault: pale mist, white boxes, the kite as the only ornament. Families and judges read it as dull. Version 2 keeps the kite and the ripstop colors and puts them where a kite actually lives: **in a vivid, moving sky**, seen through **liquid glass**. It should feel like the operating system a kid will use in 2030, not a web form.

**The sky grows up with the kid.** The kid screen's wallpaper is a living sky whose time of day follows the grade band. Sliding the grade from 1 to 10 in the demo sweeps it from noon to night.

| Band | Sky | Surfaces |
|---|---|---|
| `k2` | Noon: saturated blue, a warm sun glow top right | light glass, ink text |
| `g35` | Afternoon: azure into turquoise | light glass, ink text |
| `g68` | Golden hour: violet into coral and amber | light glass, ink text |
| `g912` | Aurora night: deep indigo, teal and violet aurora | dark glass, light text |

`.kid` paints the sky (`--sky-wall`) and two slow aurora ribbons. That drift is the only ambient motion in the product. Never add a second background layer on top of it; put content on glass instead.

**Liquid glass.** Panels, docks, app icons and sheets are translucent glass floating over the sky: `class="glass"` (or `glass-strong` for text-heavy sheets), or in a module `background: var(--glass-fill); backdrop-filter: var(--glass-blur); border: 1px solid var(--glass-edge); box-shadow: var(--glass-shadow), inset 0 1px 0 var(--glass-highlight)`. The lit top edge is what makes it read as glass, so keep it. Legibility beats translucency: text-heavy panels use `glass-strong`, and body text never sits straight on the sky.

**Color.** The ripstop accents are vivid on purpose. Tokens in `app/globals.css`:

| Token | Hex | Use |
|---|---|---|
| `--kite-red` | #ff4b3e | the one main action (talk, send), urgent alerts |
| `--kite-yellow` | #ffc83d | highlight, focus ring, "new" |
| `--tail-teal` | #12c9a8 | success, "got it", solid ideas |
| `--ultraviolet` | #7b5cff | Kite's own color: Ask Kite, AI suggestions, "care" alerts |
| `--bloom` | #ff5fa2 | creations (movies, games, stories) |
| `--ink` / `--paper` | flip per surface | text and panel fill; dark on the night band and the grown-up console |

Use the semantic tokens (`--ink`, `--ink-soft`, `--paper`, `--line`, `--glass-*`) for surfaces and text, never raw white or navy, so a component works on both light and dark glass. Gradients are allowed for the sky, the talk orb, app icon tiles and data fills. They are not allowed as washes behind ordinary text.

**Type.**
- Atkinson Hyperlegible (`--font-body`) is for reading. It was designed for legibility, which suits kids learning to read.
- Bricolage Grotesque (`--font-display`) is variable on weight, width and optical size. Use it expressively: clocks, greetings and big numbers go heavy and condensed (`font-weight: 800; font-stretch: 75%`), up to `--step-6`. Numbers use `font-variant-numeric: tabular-nums`.
- Avoid all-caps labels, eyebrow labels over headings, and single-word color accents in headlines.

**Shape.** Radius encodes hierarchy, not one radius everywhere: windows and sheets `--radius-xl` (36px), panels `--radius-l` (28px), items inside a panel `--radius-m` (16px), chips and pills fully round. App icons are squircles (`border-radius: 28%`). The talk control is the kite's diamond; it morphs toward a circle while it listens (Material 3 Expressive shape morphing, a Motion spring on `border-radius` and `rotate`).

## Kite OS: the shell (`/os`)

Kite OS is a futuristic, AI-native shell for the school Chromebook (see `VISION.md`). For the hackathon it is a web app, but it must look and behave like an operating system, with Kite as one app among many and Ask Kite available everywhere.

- **Desktop.** The sky, a glass status bar (Kite OS mark, date and time, wifi and battery, the kid's initial, mute), a big condensed clock and greeting, and a grid of squircle app icons, each with its own vivid gradient tile: Kite, Classroom, Assignments, Quizzes, Calendar, Stories, My creations, and more.
- **Today.** A glass column where Kite surfaces what's next, proactively: the next assignment due, a quiz that pauses Kite, a creation that's ready, a question Kite wants to come back to. This is the AI-era part: the shell anticipates, it doesn't only launch.
- **Ask Kite everywhere.** A floating glass bar at the bottom of every screen, with the talk orb in the middle, whichever app is open.
- **Apps open as glass windows** (`--radius-xl`) with a title and close, over the sky.

**The handheld** (`/os?device=handheld`, 390×844) is a kid-safe AI phone launcher, not a shrunken desktop: a lock-screen style clock, widgets (next class, location shared with family, field-trip mode), approved contacts to call or text, a camera "What's this?", SOS, and the talk orb as a walkie-talkie at the bottom center. No app store, no browser, no feeds.

## The grown-up console (`/parent`, `/counselor`)

`.grown` is the twilight console: the same sky an hour after the kid's goes dark, deep indigo with one violet and one teal glow. It feels calm and trustworthy, but rich. It is not pale and it is not a near-black terminal.

- **Tabs, not one long page.** A glass app bar holds the Kite mark, the kid's name and grade, and a pill tab bar with a sliding indicator (Motion `layoutId`). Each tab is one job. The tab is kept in the URL hash so a reload stays put.
- **Fill it.** Every tab shows real data from the brain, in full: charts, timelines, quotes, counts, receipts. Empty states say what will appear and when.
- **Hierarchy by size.** A large hero panel leads each tab; smaller panels follow in a grid of unequal sizes. No identical card grids.
- **Data colors.** Teal for solid, yellow for growing, violet for Kite, bloom for creations, red only for urgent. Charts follow the `dataviz` rules: direct labels, no legends where a label fits.
- **Urgent things are never hidden by a tab.** An SOS or a new alert shows in the app bar on every tab.
- Line length stays under 80 characters for prose.

## Layout

- The kid screen is centered around Kite and voice-first: the hold-to-talk control leads, and typing waits behind a "Type instead" toggle each device remembers.
- Grown-up text is left-aligned, with hierarchy shown by size and order.

## The kid screen grows up with the grade band

`data-band` on the kid page's root picks the band. It comes from `bandFor(grade)` in `lib/band.ts`, where the grade is `GET /kids/{kid}/me` or the grade slider's value. In the demo, sliding from grade 1 to grade 10 visibly changes the screen.

| Band | Feel | Text | Touch target | Corners | Spring bounce | Sounds |
|---|---|---|---|---|---|---|
| `k2` (K-2) | big, bouncy, picture-first | `--kid-text` ≈ 26px | 76px | 30px | 0.3 | all |
| `g35` (3-5) | playful, confident | ≈ 21px | 64px | 24px | 0.2 | all |
| `g68` (6-8) | relaxed, less babyish | ≈ 19px | 54px | 18px | 0.1 | confirmations and celebrations |
| `g912` (9-12) | clean, almost a grown-up app | 17px | 48px | 14px | 0 | confirmations only |

Use the CSS variables (`--kid-text`, `--target`, `--radius-kid`, `--kite-size`) and `SPRING[band]` from `lib/band.ts`. Don't hard-code per-band numbers.

## Motion

These follow Emil Kowalski's animation rules.

- **Ambient motion.** Only the sky's aurora drift (in `globals.css`) moves on its own. Nothing else loops.
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
  - Parent: `app/parent/*`, `components/parent/*`
  - Counselor: `app/counselor/*`, `components/counselor/*` (its own model and CSS; don't import from `components/parent/`)
- **Styling.** Use CSS Modules next to the component, built on the tokens above. No CSS framework.

## Verifying

- **The brain.** A real brain is already running at `http://localhost:8001`. Don't start or stop it. Each helper runs its own Next dev server: `BRAIN_URL=http://localhost:8001 npx next dev -p <your port>`.
- **Pairing.** Device tokens are in `/tmp/claude-1000/-home-gpuligundla-deerbrook-tmp/a7ebbef2-6497-428b-bfd0-4686419deadf/scratchpad/tokens.env`, as `OS_TOKEN`, `PARENT_TOKEN` and `COUNSELOR_TOKEN`. Source it into the environment and never print it. Pair a browser with `/setup?token=$OS_TOKEN&to=os`, or `to=parent`, `to=counselor`, `to=handheld`.
- **Playwright.** It's installed in the repo. Use one browser context per device. For hold-to-talk, launch Chromium with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<a .wav>`.
- **Look at it.** Screenshot every screen at 1280×800, and at 390×844 for `?device=handheld`. Review the screenshots, fix what looks off, and keep the final ones.
- **Keep real model calls modest.** Each turn calls Claude and ElevenLabs, so stay under about 15 live turns per helper.
