# Kite at HarborHack 2026: locked design (v2)

**Status:** v2, revised Sat Oct 24, 2026 at about 2:45 PM EDT. It replaces v1 and `HACKATHON_BUILD.md`.

Two things changed since v1:

1. **An adversarial review.** Four models (Opus, Fable, Sonnet, Haiku) reviewed v1, and this version fixes what they found.
2. **New requirements from the team:**
   - All models run on Foundry. Voice runs on ElevenLabs and adapts to the kid.
   - A new "Teach Kite" mode.
   - A kid-only view of the profile.
   - A simulated homework guard.

Product vision is in `VISION.md`. Decision history is in `COLLAB_LOG.md`.

## 1. Intent

Kite is an AI companion that grows up with a kid from kindergarten to 12th grade.

- **Same companion, every device.** It lives on whichever device the kid has at each age.
- **Personal teaching.** It remembers what the kid learned and teaches each idea the way that kid learns best.
- **Grown-ups stay in the loop.** Parents and teachers see what's happening.

At HarborHack we show a working glimpse of that future: a real system, two physical devices, one brain, and a simulated childhood.

**Judging** is split into three equal thirds:

- **Value:** K-12 learning plus child safety. Schools and families both pay.
- **Achievement:** judges read the codebase.
- **Non-human collaboration:** AI teammates with named jobs, plus `COLLAB_LOG.md`.

**Hard dates**

- **Devpost submission is due Sun Oct 25 at 4:00 PM EDT.** We submit by 3:30 and tag that commit `submission`. We demo the tagged commit unless the organizers say later changes are allowed.
- **The live demo is Sunday evening:** 5–6 minutes, with HDMI video and audio.
- **The submission needs** a public GitHub repo, a 2–5 paragraph description, and a Non-Human Collaboration Story.

### Goals: what the demo proves

1. **Grade time travel.** Maya asks the same question at grades 2, 7 and 11 on Kite OS.
   - Each answer is right-sized and uses her memory *as of that grade*.
   - Each answer shows a measured reading level.
   - On her strength topic, the answer goes deeper and shows a "deeper" chip.
2. **Live movie.** "Make it a movie" produces a narrated 2D cartoon of about 40 s starring her characters.
   - It starts playing in the browser in about 20 s.
   - A full MP4 with the ElevenLabs narration renders in the background and appears under "Maya's movies" on the dashboard.
3. **The handheld.** A real Android phone runs Kite as its home-screen launcher. It shows hold to talk, "what's this?" with the camera, and an SOS that appears live on the parent dashboard.
4. **The parent dashboard.** It shows ten simulated years of Maya:
   - a curiosity map
   - growing areas
   - "can teach" concepts
   - big-question cards with conversation starters
   - live alerts
   - family-values controls that change the next answer
5. **Teach Kite.** The idea comes from Einstein: "If you can't explain it simply, you don't understand it well enough."
   - Maya explains a concept, and Kite just listens.
   - Then Kite celebrates what she got right and helps with what she missed.
   - A perfect explanation marks the concept "can teach."
6. **Homework guard,** on a simulated class.
   - A question from open homework gets hints and guiding questions.
   - A question from a live quiz gets a kind pause.
   - A question from a closed quiz gets the full worked solution.
7. **The grown-ups' view stays private.** Kite doesn't tell Maya her levels or scores. On "tell me about me" turns, the model doesn't even have them.
8. **Brand-new games, built by a sandboxed coding agent.**
   - "Build me a brand-new one!" sends a coding agent to write, play-test and fix a new game.
   - The game arrives in 1–3 minutes. She plays the template game while she waits.
9. **Visible AI teammates:**
   - a simulated childhood (grades 1–11), played by AI persona agents through the real turn pipeline
   - a red-team scorecard
   - a reading-level chart

### Non-goals (slides or roadmap)

- Fine-tuned models
- A custom OS image
- The teacher class view
- Real logins and multiple families
- On-device models and dedicated hardware
- Family-held keys
- Storybook mode, and teacher-set homework strictness
- Hands-free voice
- AI image or video generation models. Movies and games use SVG sprites and JS animation instead.
- Tavus and Jev
- Offline mode
- IEP accommodations (this is health data, so it stays on the roadmap)
- Bilingual voices
- Matching homework from a photo of a worksheet
- **Real LMS connectors (Canvas, Google Classroom).** The simulated class uses Canvas's assignment format, so a connector can drop in later.

### Anti-goals (failures even if the code works)

- Real children's data anywhere.
- A synthesized child voice. Every voice comes from a fixed list of adult voices.
- Claude deciding whether a grown-up gets told.
- Personal life details (feelings, family, friends, health) in long-term memory.
- A kid seeing grown-up data.
- A parent seeing a disclosure that was routed to the counselor.
- Comparing kids with each other: no rankings, no peer comparisons.
- Claiming "even we can't read it."
- An unsafe answer, a broken game, or a polluted demo database on stage.

## 2. Locked decisions

| # | Decision |
|---|---|
| D1 | **Phone app.** A native Expo app registered as the Android home-screen launcher. The phone must run hello-world by **Sat 4:30 PM**. If it doesn't, we fall back to `/os` installed as a web app on the phone, with camera input and an SOS button. |
| D2 | **Movies.** Our own animation pipeline, kept simple: SVG sprites and scene templates, animated with a JS library (Remotion), plus ElevenLabs narration. It plays live in the browser and renders to a full MP4 with sound. |
| D3 | **Talking.** Hold to talk. Teach Kite uses tap to start and tap to finish instead (§11). |
| D4 | **Languages.** TypeScript for every UI (Next.js, Expo). Python for the brain (FastAPI). |
| D5 | **Hosting.** Develop locally behind an HTTPS tunnel. Deploy to Azure Container Apps on Sunday morning. |
| D6 | **People.** No fixed ownership: there are two lanes, and either engineer can take either one. |
| M1 | **Classification and routing.** Microsoft-Decision-1, with Claude Haiku as a fallback that returns the same labels. |
| M2 | **What the cloud keeps.** Only learning data, and interests count as learning data. Feelings, family, friends and health are never stored. |
| M3 | **Ownership.** The school sets up the profile, the family owns it, and teachers see the learning parts. |
| M4 | **Retention.** Chat text: a rolling 30 days. Alert excerpts: 1 year, restricted. The learning profile: until the family deletes it. |
| M5 | **Tone and depth.** The grade sets the tone and the content limits. Curiosity sets the depth: on strength topics, up to 3 grades deeper. |
| M6 | **Memory storage.** No mem0 or Supermemory. Memory is our own append-only, grade-stamped ledger, with per-family envelope encryption. |
| M7 | **What the kid sees.** Only their interests, favorite characters and learning moments. Levels, growing areas, scores, cards, alerts and policies are for grown-ups. |
| M8 | **Homework guard.** Runs on a **simulated class** this weekend, because no LMS API is available. Open work gets `help`, a live quiz or exam gets `pause`, and closed work gets `explain`. |
| M9 | **Models and voice.** Every model comes from **Azure Foundry**: Claude, Decision-1, embeddings and Content Safety. There is no image model; art is SVG. Everything spoken or heard goes through **ElevenLabs**. Voice adapts to grade band and situation (§6). |
| M10 | **Teach Kite mode.** The kid explains and Kite listens without interrupting. Kite grades the explanation against the concept's key points, then celebrates or helps. A perfect explanation sets "can teach." |
| M11 | **Brand-new games (Studio Pro).** A Foundry hosted agent runs the Claude Agent SDK (Claude Code's harness), with Claude on Foundry, in a VM sandbox created for each game. It writes a KAPLAY game, play-tests it with Playwright, fixes it and returns one HTML file. The template game always appears first. It's all billed through Azure. |

## 3. System shape

```
kite/
├─ brain/                Python 3.12 · uv · FastAPI · the only service
│  ├─ kite_brain/        routers/, turn/, memory/, studio/, voice.py, decide.py, crypto.py, bus.py
│  ├─ evals/             simulator, red team, pedagogy judge
│  └─ tests/             conftest.py owns every fake (FakeDeps)
├─ apps/web/             Next.js (TypeScript) · /os · /parent · /counselor · /setup
├─ apps/handheld/        Expo (TypeScript) · Android launcher
├─ packages/client/      generated contract types, brain client, talk reducer
└─ docs/
```

### The contract

- Pydantic models in the brain are the source of truth.
- `export_openapi.py` writes the FastAPI OpenAPI schema. It also merges in `TypeAdapter(KiteEvent).json_schema()` and the other stream payload schemas, because OpenAPI doesn't describe server-sent events.
- `openapi-typescript` turns that schema into types in `packages/client`.

### Who can see what

Every device has a **kind**: `os` and `handheld` belong to the kid, plus `parent` and `counselor`. Every event carries an **audience**: `kid`, `parent` or `counselor`.

| Subscriber | Receives |
|---|---|
| Kid devices | `kid` events only |
| Parent | `parent` events only |
| Counselor | `counselor` events |

- **The kid's events** are only `heard` (its own words), `answer.sentence`, `answer.done` and `creation.*`.
- **A turn's grown-up events** (`heard`, `decided`, `recalled`, `routed`, `alert`, `card`) are published *after* routing, so their audience is known. The pipeline also publishes a grown-up copy of each `answer.sentence` and `answer.done`, and the studio does the same for `creation.*`. That's why the parent never subscribes to `kid` events: the kid's `heard` goes out before routing, so the parent can't receive it without seeing an abuse turn too.
  - If a turn is routed to the counselor, all of these events go only to `counselor`. The parent never sees that turn.
- **The stage x-ray** uses a parent token.
- **One dependency, `require(kinds)`, checks every endpoint:**
  - Dashboard, policy, trust, receipts and contacts-admin require `parent`.
  - `/counselor/*` requires `counselor`.
  - Turn and SOS endpoints require a kid device.

### Auth without tokens in URLs

- **Web.**
  - Next.js rewrites `/brain/*` to the brain, so the browser talks to one origin and there's no CORS.
  - `/setup?token=…` stores the device token in an httpOnly cookie once.
  - The brain accepts the token from that cookie or from `Authorization: Bearer`.
- **Phone.**
  - The phone sends `Authorization: Bearer` on fetches and on server-sent events (`react-native-sse` supports headers).
  - A first-launch setup screen, or a `kite://setup?url=…&token=…` deep link, stores the brain URL and token in Android secure storage. Nothing is baked into the bundle, so a new tunnel URL doesn't need a rebuild.
- **Media.**
  - Spoken audio arrives inline as base64 MP3 inside `answer.sentence`.
  - Movie assets are served under an unguessable 128-bit creation id, without a token and outside the rate limit. They're generated cartoons, not kid data.
- **Rate limit:** 300 requests per minute per token.

### Uploads and logs

- **Uploads** are capped at 900 KB and read into memory. Starlette spools larger uploads to disk, so this keeps "never on disk" true.
- **The phone** records at 32 kbps mono and downsizes camera frames.
- **Kid audio and image bytes** are never written to disk or to the database.
- **Logs.** Access logs are off (`--no-access-log`). Logs carry IDs and timings only, never conversation text.

### Deployment (Sunday)

- **One brain replica** on Azure Container Apps. The bus lives in memory, so it needs a single instance.
- **SQLite on the container's local disk.** The night-shift snapshot is checkpointed and copied into the image, so a restart returns to the snapshot.
- **`.dockerignore`** excludes `.env` and `data/`, except the snapshot.

### External services (M9)

| Job | Service |
|---|---|
| Spoken answers, storyboards, game code | Claude **Sonnet 5.5** on Foundry, chosen because it starts speaking faster. Opus 5.5 is the switch if you want quality over speed. |
| Memory writer, fallback classifier, persona agents | Claude **Haiku 5.5** on Foundry |
| Classification, routing, rubric grading | **Microsoft-Decision-1** on Foundry |
| Input and output safety | **Azure AI Content Safety** and Prompt Shields |
| Embeddings | An embeddings deployment on Foundry, for example `text-embedding-3-small` |
| Movie and game art | No image model. A vendored open-source SVG sprite set, plus simple SVG that Claude draws (§9) |
| Movie rendering | Remotion (Node) renders the frames with its own headless Chrome, mixes in the ElevenLabs audio and writes the MP4 |
| Brand-new games (M11) | A Foundry hosted agent with a Python handler, the Claude Agent SDK and the Claude Code CLI on Node, plus Playwright Chromium. It calls Claude Sonnet 5.5 on Foundry with the agent's own Entra identity (`CLAUDE_CODE_USE_FOUNDRY=1`). |
| Speech to text | **ElevenLabs Scribe** (batch mode is enough for hold to talk) |
| Live spoken answers | **ElevenLabs Flash** (lowest latency) |
| Movie narration and character voices | **ElevenLabs v3** (expressive, supports audio tags), or a newer expressive model if your plan has one |

- **The Claude client.** Claude is called through the Anthropic SDK's Foundry client (`AnthropicFoundry`), using deployment names from `.env`.
- **Foundry supports everything we use:** streaming, tool use, structured outputs, prompt caching and vision.
- **Refusals.** Foundry doesn't offer server-side refusal fallbacks, and we wouldn't use them anyway. A refusal produces Kite's fixed fallback line.

## 4. The turn pipeline

`POST /turns` takes these fields:

- `kid_id`
- `device`
- `mode`: `talk` or `teach`
- one of `audio` or `text`
- `image` (optional)
- `as_of_grade` (optional; defaults to the kid's current grade; must be 0–12)

The turn runs in seven steps.

1. **Heard.** Scribe turns speech into text, and `heard` goes to the kid right away.
   - If the text is empty or only whitespace, Kite says `UNHEARD` ("I didn't catch that, hold the button and try again"). There's no model call and nothing is written.
2. **Embed once.** The kid's text is embedded a single time. That vector feeds the concept candidates, the homework match and moment recall.
3. **Three calls in parallel, each with a timeout:**
   - `decide`: all of this turn's questions in **one** Decision-1 call (§5).
   - Content Safety on the input.
   - `recall`: the kid view, guidance for this turn's concept, and the last 10 session turns (§7).

   If Content Safety or recall fails or times out, the turn goes to the fallback route.
4. **`route()`.** A pure function: `route(decisions, safety_flags, policy, homework, mode, now) -> RoutePlan`. It checks the cases below in order, and the first match wins.

   | Order | Case | What happens |
   |---|---|---|
   | 1 | **Alert** | See the alert rules below the table. |
   | 2 | **Live-quiz pause** | A fixed reply. No model, no memory write, no report. |
   | 3 | **Sensitive topic set to `ask_parent`** | A fixed reply plus a big-question card. |
   | 4 | **Teach Kite** | Only when `mode` is `teach` (§11). |
   | 5 | **Homework** | `help` or `explain` (§10). |
   | 6 | **About me** | Answered from the kid view only. |
   | 7 | **Answer** | A sensitive topic set to `answer_and_tell` also creates a card. |

   **Alert rules:**
   - Every alert label at or above its threshold counts, and Content Safety categories map to alert kinds (§5).
   - If **abuse** is in the set, the turn goes to the counselor only, and the parent gets nothing for this turn.
   - If **self-harm** is in the set, the reply includes 988 and Childhelp (1-800-422-4453), and the parent is alerted.
   - Bullying and stranger alerts go to the parent.
   - Kite's reply is fixed: kind and age-appropriate.

   **Fallback:** if both decision paths are down and Content Safety didn't flag the input, Kite says "Let me think about that one later. Ask a grown-up too!" and nothing is written.
5. **Grown-up events.** The grown-up copies of `heard`, `decided` (including which `backend` answered), `recalled` and `routed` are published to the audience the route plan chose.
6. **Answer.**
   - **Claude gets:**
     - a cached system prompt: persona, band rules, family values
     - per-turn context: kid view, guidance, the depth line, homework or teach mode, session history
     - the image, if there is one
   - **Tools:** only `make_movie` and `make_game`.
   - **Sentence by sentence.** The answer streams and is cut into sentences. Each sentence passes **output Content Safety**, then ElevenLabs, in an ordered background task so streaming never waits on speech.
   - **Events.** `answer.sentence` carries `{index, text, audio_b64}`, in order. `answer.done` carries the full text, its Flesch-Kincaid grade and `depth_override`.
   - **A flagged sentence** stops the answer, and Kite says the fallback line.
   - **No per-token events.** The kid sees each sentence as it's spoken, so text first appears about 2–3 s in. That's fine for a voice-first kid.
7. **Persist.**
   - **Time-travel turns are read-only.** If `as_of_grade` is below the kid's current grade, nothing goes to memory or chat history. An alert is still recorded, because it's the safety record.
   - **Other turns** write a `session_turn` row that expires 30 days after the real write time, then schedule the memory writer (§7).
   - **Sessions.** A gap of more than 30 minutes starts a new session.

## 5. Decision-1: what it decides

- **One function:** `decide(context, questions) -> Decisions`. It's called once per turn, plus once by the memory writer.
- **Wording.** Question wording and answer sets live only in `questions.py`.
- **Backends, tried in order:**
  1. Decision-1 on Foundry, with a 1.5 s timeout.
  2. Decision-1 through OpenRouter. This is allowed this weekend only, because all data is synthetic.
  3. Haiku with structured output, through a model built with `create_model` for dynamic answer sets. It returns probability 1.0 for the label it picks.
- **`decided.backend`** records which one answered.

| Question | Answers | When it's asked |
|---|---|---|
| safety | `ok`, `alert_bullying`, `alert_stranger`, `alert_abuse`, `alert_self_harm` | every turn |
| sensitive_topic | `death`, `religion`, `bodies`, `war`, `divorce`, `none` | every turn |
| initiative | `own_question`, `follow_up_why`, `assigned_work` | every turn |
| concept | up to 6 nearest catalog concepts, plus `none` | every turn |
| about_me | `yes`, `no` | every turn |
| teach_point (one per key point) | `covered`, `partly`, `missing`, `wrong` | Teach Kite turns |
| is_learning_fact (one per candidate fact) | `yes`, `no` | memory writer |
| forget_request, about_kite | `yes`, `no` | Tier 2 |

**Thresholds** (in `config.py`):

| Threshold | Value | Notes |
|---|---|---|
| Each alert label | ≥ 0.20 | Labels are counted independently, so one turn can raise several alert kinds. |
| `about_me` route | ≥ 0.20 | This also drops the teaching guidance. |
| `forget` route | ≥ 0.5 | Checked after alerts and the fallback, before everything else. |
| `is_learning_fact` | ≥ 0.80 | |
| `assigned_work` | ≥ 0.5 | |

**When the fallback answers:**

- Every alert label it picks fires an alert.
- Memory writes **fail closed**: if the memory call fell back, no profile facts are written.

**Content Safety mapping** (severity ≥ 4, in `config.py`):

| Content Safety category | Alert kind | Who gets it |
|---|---|---|
| SelfHarm | `self_harm` | parent |
| Sexual | `abuse` | counselor |
| Violence | `abuse` | counselor (the safer adult for ambiguous violence) |
| Hate | `bullying` | parent |

The severity floor keeps ordinary questions about war, death or bodies on the family-values path.

**Microsoft's caveat.** Microsoft says the model shouldn't be the only basis for high-impact decisions about people. We meet that in three ways:

- Content Safety runs alongside it, and either one can escalate.
- Every alert goes to a human. In Tier 1, abuse alerts are stored and scored; the counselor inbox comes in Tier 2. We say that plainly.
- The adult sees the kid's actual message, not a model's rationale.

**De-risk first.** The first brain task calls Decision-1 once and confirms it returns a probability for each answer. If it returns only labels, the thresholds become label-only and we say so.

## 6. Grade policy, depth and voice

### Grade bands

| Band | Target FK | Max words per sentence | Style |
|---|---|---|---|
| K–2 | ≤ 2 | 12 | Story-first, concrete, one idea at a time |
| 3–5 | 3–5 | 16 | Analogies plus a simple "why" |
| 6–8 | 6–8 | 22 | Mechanisms, a light Socratic nudge |
| 9–12 | 9–12 | 28 | Formal terms, a Socratic question at the end |

Each band also sets content rules by age, humor, and how often Kite asks a question back.

### The depth override (M5)

A topic is a **strength topic** at grade *g* when both of these hold:

- It's in the top 3 of the curiosity map, with a normalized score of at least 0.6, as of the end of grade *g*.
- At least 2 of its evidenced concepts at or below *g* are at `got_it` or better, and those make up at least 75% of its evidenced concepts. One shaky concept among several mastered ones doesn't erase a strength.

On a strength topic, Kite may teach concepts up to **3 grades above** *g*. It still uses the kid's own band language and content rules. The per-turn depth line carries this, and `answer.done.depth_override` marks it.

### Voice (M9, ElevenLabs)

**Kite's voice grows up with the kid.**

- **Voice by band.** Each band has a voice from a curated list of adult voices. Kite's voice changes at band boundaries, which ties into the yearly "Kite evolves" moment.
- **Delivery by band.** Speed, stability and style follow the band: K–2 is slower and more expressive; 9–12 is natural speed and steadier.

**Delivery also changes with the situation:**

| Situation | Delivery |
|---|---|
| `answer` | The band's default |
| `homework_help` | Encouraging |
| `explain` | Clear and measured |
| `big_question` | Gentle and slower |
| `alert` | Calm, steady, slowest, no expressive style |
| `celebrate` (a Teach Kite success) | Warm and upbeat |
| `listen` (Teach Kite prompts) | Soft and inviting |
| `story` (movies) | The expressive model, with audio tags such as excited or whispering |

**Models.** Live answers use Flash for speed. Movies use the expressive model.

**Structural safety:**

- `VOICES` is a fixed allowlist of adult voice IDs.
- `voice_for(band, situation) -> VoiceSpec(voice_id, model_id, settings)` is the only way to get a voice.
- Storyboard characters pick from a named list of adult character voices.
- A test asserts that every voice ID used is on the allowlist.
- Check setting names against the ElevenLabs docs when building.

## 7. Memory: the learning ledger

### Storage

The ledger is SQLite (WAL mode) through `sqlite3` from the standard library, with one `schema.sql`. The connection sets `PRAGMA secure_delete=ON`. In production it would be Postgres with pgvector.

| Table | Contents | Encrypted |
|---|---|---|
| `family` | id, name, wrapped data key | — |
| `kid` | id, family_id, display name, current grade, school start year, settings | settings |
| `device` | id, kid_id, kind (`os` \| `handheld` \| `parent` \| `counselor`), token hash | — |
| `contact` | id, kid_id, name, phone (parent-approved) | name, phone |
| `learning_event` | id (ULID), kid_id, grade, at, session_id, kind, concept_id, topic, source_turn_id, payload | payload |
| `moment_vector` | event_id, embedding | embedding |
| `session_turn` | id, kid_id, session_id, device, role, at, expires_at, text | text |
| `alert` | id, kid_id, kinds, routed_to, at, expires_at, excerpt (the flagged message plus the 2 turns before it), lat and lng (SOS only) | excerpt, location |
| `big_question_card` | id, kid_id, grade, at, topic, a summary of Kite's explanation, a conversation starter. Never a quote from the kid. Parents can delete it. | summary, starter |
| `policy` | family_id, topic, action | — |
| `assignment`, `assignment_item` | See §10 | description, text, embedding |
| `access_receipt` | who, kid_id, what, at | — |

- **Concept catalog.** The catalog is `concepts.json`: id, name, subject, grade, standard code, prerequisites, topic, and **3–5 key points**. It's loaded at startup, and its embeddings are precomputed at seed time into `data/concept_vectors.npy`. There's no concept table.
- **Creations** are stored as files under `data/creations/{id}/`: `creation.json`, the narration MP3s and, once rendered, `movie.mp4`.

### Ledger payloads

Payloads are Pydantic models, discriminated on `kind`:

| Kind | Payload |
|---|---|
| `concept_evidence` | `{outcome: got_it \| partly \| not_yet, source: teach_back \| check_question \| game, points?: {key_point: verdict}}` |
| `curiosity_signal` | `{signal: own_question \| follow_up_why \| return_visit \| chose_creation}` |
| `profile_fact` | One of three shapes: `{fact_kind: interest, topic: <catalog topic id>}`, `{fact_kind: favorite_character, name: str ≤ 40}`, or `{fact_kind: learning_style, style: story \| game \| picture \| explain \| hands_on}` |
| `moment` | `{concept_id, character: str \| None, source: answer \| movie \| game \| teach_back}`. The text is **rendered from a template**, for example "Figured out why the sky is blue, with Rexy". No free text is stored. |

### Evidence counts what the kid can show, not what Kite said

Concept evidence comes only from:

- Teach Kite rubrics
- answers to the movie check question (a button press)
- game results

Kite's own answers produce curiosity signals and moments, never mastery.

### The write gate (M2), enforced by structure first

1. **Types.** Payloads are enums or templates. The only free text is a favorite character's name, at most 40 characters.
2. **The writer** is Claude Haiku with structured output, and it can only emit those types.
3. **The classifier check.** Each `favorite_character` candidate needs `is_learning_fact` ≥ 0.80. All candidates go in one batched Decision-1 call per turn, and the check **fails closed** when the fallback answered.
4. **Dedupe is deterministic.** A fact with the same kind and value is ignored. Facts are add-only, and only forgetting removes them. There's no reconcile question and no "update."
5. **Proof.** The night shift runs the live write-gate check and publishes it with the scorecard. A unit test with fakes only proves the wiring.

### Views (maps) as of a grade

Every view takes `(grade g, as_of = school_year_end(kid, g))` and filters to `learning_event.grade <= g`.

- **Profile:** interests, characters and learning style.
- **Skills map:**
  - `got_it` means the last two outcomes are `got_it`.
  - `can_teach` means a Teach Kite rubric had every point covered.
  - `learning` means any other evidence.
  - `not_yet` means every outcome so far is `not_yet`.
  - **Growing areas** are concepts below `got_it` across 2 or more sessions.
  - **The frontier** is concepts with no evidence yet whose prerequisites are all `got_it` or better.
- **Curiosity map:**
  - Signal weights: own_question 1, follow_up_why 2, return_visit 3, chose_creation 3.
  - Decay: half-life of 180 days, measured from the `as_of` date.
  - Scores are normalized per kid, with a trend for each grade.
- **How she learns (Tier 2):** for each mode, how often a concept reaches `got_it` within 2 sessions of meeting it in that mode.

### Recall

Recall returns:

- the kid view
- guidance lines
- the last 10 session turns
- the top 5 moments by cosine similarity

Guidance covers only this turn's concept, written as teaching instructions with no levels or scores. For example: "Check her steps carefully; this concept has tripped her before." Guidance is dropped entirely when `about_me` is at least 0.20.

### Forget (Tier 2)

Forgetting a turn deletes its learning events, its `moment_vector` rows, its `session_turn` row and its card. Alerts stay as the safety record.

A turn routed `forget` forgets the kid's previous stored turn and replies "Okay, I forgot that." with no model call. It stores nothing itself, so saying it again reaches the turn before. A time-travel turn forgets nothing.

### Expiry

A background task runs at startup and then hourly. It deletes `session_turn` and `alert` rows past `expires_at`. `expires_at` is computed from the real insert time, never from simulated dates.

### What the kid can see (M7)

| Kid view (Kite may say it) | Grown-up view only |
|---|---|
| Interests and favorite characters | Skills levels, frontier, growing areas, "can teach" |
| Learning moments ("you taught me how rainbows work!") | Curiosity scores and trends, "how she learns" |
| Encouragement on deep topics ("you're turning into a dinosaur expert") | Cards, alerts, policies, receipts |

How it's enforced:

- **Types.** The studio and game writers take a `KidView`, never `Recall` or `SkillsMap`.
- **About-me turns.** The model gets only the kid view.
- **Normal turns.** Guidance covers only the current concept, and it's dropped whenever an about-me question is plausible.
- **Tests** assert over the **whole request** sent to Claude.
- **The red team** includes disclosure attacks.

**What we say on stage:** "Kite doesn't tell kids their levels or scores. When they ask about themselves, it doesn't even have them."

If the kid asks whether grown-ups can see things, Kite honestly says yes, in general terms.

## 8. Encryption

- **Per-family keys.** Each family has its own data key, used with AES-256-GCM (`cryptography`) and a 12-byte random nonce.
- **Values are bound to their rows.** Each value is bound to `"{table}:{kid_id}:{row_id}"`.
- **Key storage.** Family keys are themselves encrypted under a master key. That master key is in `.env` this weekend and would be in Key Vault in production.
- **Passkey unlock** (Tier 2) gates the parent's data endpoints, and every read writes an access receipt.
- **Deleting a family.** Deleting a family's key, then running `VACUUM`, makes that family's encrypted content unreadable in the live database.
  - Metadata stays readable: grade, time, kind and topic.
  - Making backups unreadable too would need family keys stored outside the database, in Key Vault. That's the production path, and we don't claim it now.
- **Honest limit.** The server can decrypt in this phase.

## 9. Kite Studio

### Sprites (shared by movies and games)

- **Vendored sprite set.** Characters and props come from an open-source SVG set that we vendor and look up by name, for example Microsoft Fluent Emoji (flat style). Check the license before vendoring it.
- **Hand-drawn fallback.** When nothing fits, Claude draws a simple SVG under 4 KB.
- **Sprites stay inert.** SVGs load as `data:` image URLs, so any script inside one never runs.
- **Rexy and other characters** are a sprite plus a name. Each kid's character choices are cached and reused.

### Storyboard

Claude writes the storyboard as structured output from the topic, the learning goal and the `KidView`. The storyboard contains:

- **Scenes:** at most 5, with about 40 s of narration in total.
- **Background per scene:** one of 6 templates (sky, space, ocean, forest, town, classroom), with colors and time of day.
- **Characters and props per scene:** each has a sprite, an entrance (`left`, `right` or `pop`) and a motion (`bounce`, `float` or `walk`).
- **Narration lines:** each as `{speaker, text}`. Each character's voice comes from the adult character-voice list.
- **Camera:** `still`, `pan` or `zoom`.
- **A check question** at the end.

### Movie

1. **Narration.** Each narration line goes to the ElevenLabs expressive model, through a `Semaphore(3)`. ElevenLabs returns timing for each character of text, and we group that into words.
2. **Live playback, at about 20 s.**
   - `packages/movie` holds one Remotion composition, `KiteMovie`. It renders background templates and sprites with parallax, entrances and bounce-while-speaking, plus word-synced captions and the audio.
   - The web app plays it immediately with `@remotion/player`.
   - `creation.progress` fires for each line of narration, and `creation.ready` fires once it can play.
3. **Full video.**
   - In the background, the brain runs `node packages/movie/render.mjs <creation.json>`, which uses `@remotion/renderer` `renderMedia`.
   - This renders the same composition frame by frame in headless Chrome, mixes in the narration, and writes `movie.mp4`.
   - `creation.video` fires when it's done. The parent dashboard lists it under "Maya's movies" with a download link.
4. **Deadline.** If the movie can't play within **45 s**, or anything fails, the cached fallback movie plays instead. The fallback includes its MP4.
5. **Check question.** The answer is recorded as `concept_evidence` with source `check_question`.

**Remotion license.** Remotion's free license covers individuals and very small teams. Confirm this at remotion.dev and note it in the README. The brain's container needs Node 24 for rendering.

**Testing.** Playwright isn't used for video. We use it for one end-to-end smoke test of the demo path (§14).

### Game (Tier 2): simple 2D templates

Claude doesn't write game code. It fills in a game template we built. With no generated code to run, the plan needs no play-test or repair loop.

- **Templates.** There are two small 2D templates, built on a JS game library (KAPLAY, or Phaser if the builder prefers). They use the shared sprite set:
  - **`catch`:** catch the right falling items. For example, blue light, not red.
  - **`sort`:** drag items into 2–3 bins. For example, area vs. perimeter, or mammal vs. reptile.
- **`GameSpec`.** Claude returns a `GameSpec` as structured output, built from the topic, the learning goal and the `KidView`:
  - `template`, `title`, `instructions`, `concept_id`
  - `items`: each has `label`, `sprite`, and `correct` or `bin`
  - `bins`, for the `sort` template
  - sprite names from the shared set, or simple SVGs under 4 KB
- **The page.** The game renders in a React component on `/os`, with no iframe.
- **Fallback.** If generation fails or takes longer than 20 s, the cached sky-is-blue `catch` game is used.
- **Results.** The game's score is recorded as `concept_evidence` with source `game`.

### Brand-new games (Studio Pro, M11)

1. **Trigger.** The kid presses "Build me a brand-new one!", which calls `POST /kids/{id}/games/custom {topic, learning_goal}`. Kite keeps the template game on screen and says "I'm building you a brand-new game!"
2. **Request.** The brain calls the `kite-studio` hosted agent over its Invocations endpoint with an Entra token. It sends the creation id as the session id, plus the topic, the goal, the grade and the `KidView`. It never sends levels.
3. **Inside the sandbox.**
   - The handler starts the Claude Agent SDK with fixed instructions. Use only KAPLAY. Produce one HTML file with no network calls. Make it kid-safe and use her characters. The game isn't done until `npm run playtest` passes.
   - Tools are limited to Read, Write, Edit and Bash, inside `$HOME/game`. There is no web access.
   - The play-test passes when the game loads, runs for 5 s with no errors, calls `kite.ready()`, and the canvas changes after a simulated input.
   - The run is capped at 8 turns or 3 minutes.
4. **Back in the brain.**
   - Content Safety checks every text string in the game.
   - The brain saves `game.html` under the creation and publishes `creation.ready` with `status="ready"` (a grown-up copy goes to the parent too).
   - Any failure, timeout or flag publishes `creation.ready` with `status="fallback"`. She keeps the template game.
5. **Play.** The browser runs `game.html` in `<iframe sandbox="allow-scripts">` with a content security policy that allows no network access.
6. **Results.** `kite.finish({correct, total})` records `concept_evidence` with source `game`, the same as the template games.

The handler is Python, because hosted agents support only Python and C#. The container also holds Node 24, the Claude Code CLI, Playwright's Chromium, and a vendored copy of KAPLAY. The Foundry project must be in a hosted-agent region. Cold starts are unpublished, so expect 1–3 minutes per game.

## 10. Homework guard on a simulated class (M8)

- **Source.**
  - `assignments.json` holds Maya's class. It uses Canvas's assignment format (title, description with numbered questions, `unlock_at`, `due_at`, `lock_at`, quiz flag).
  - Dates are stored as **offsets from load time**, so the "live" quiz is live during every rehearsal and the demo.
  - It's loaded at seed through `load_assignments(kid_id, now)`. A real Canvas or Google Classroom connector would replace only this one function.
  - Suggested contents:
    - open homework on area and perimeter, due tomorrow
    - a closed quiz on light and color, last week
    - a quiz on the water cycle, live right now
- **Status.**
  - `exam_live`: a quiz or exam that is unlocked and not yet locked or due.
  - `open`: homework that isn't locked yet.
  - `closed`: everything else.
- **Matching.**
  - A question matches when its nearest assignment item has cosine ≥ 0.80.
  - While any quiz is live for this kid, the guard pauses on a near match (cosine ≥ 0.60) or a question on the same concept or topic as the live quiz. Other assigned work (`assigned_work` ≥ 0.5) pauses too, unless it can be placed on another assignment: an item match (cosine ≥ 0.80), or the concept's topic for open homework only. A topic alone never unlocks a closed assignment's worked solution.
  - With no live quiz, unmatched assigned work (≥ 0.5) gets `help`.
- **Modes.**
  - `help`: hints and one guiding question. Never the final answer.
  - `pause`: a fixed reply.
  - `explain`: the full worked solution, deriving each step.
- **`routed`** carries the mode and the assignment title.
- **Tests** use paraphrased questions and assert that the *answer* in `help` doesn't contain the final number.

## 11. Teach Kite (M10)

1. **Start.**
   - The kid taps **Teach Kite** on `/os` or the phone and picks a recent concept. The picker shows concepts she has met, in kid words.
   - Kite says a fixed line in the `listen` voice: "I'm all ears! Teach me everything you know about {concept}."
2. **Listen completely.**
   - Recording is tap to start and tap to finish, for up to 2 minutes (900 KB at 32 kbps).
   - Kite doesn't interrupt and sends nothing back while she talks.
3. **Grade.**
   - One Decision-1 call asks `teach_point` for each of the concept's 3–5 key points, plus the safety questions.
   - Points add up across attempts in the same session.
4. **Respond.** Claude gets the rubric and her words.
   - **All points covered:** specific congratulations in the `celebrate` voice ("You explained why blue scatters more. That's exactly it!"). The concept becomes `can_teach`.
   - **Otherwise:**
     - First, praise for what she got right.
     - Then one guiding question about the first point that's missing or wrong, without giving it away.
     - Then: "Want to try that part again?"
     - A `wrong` point is a misconception, and Kite checks it gently ("Hmm, does the sky scatter red more, or blue?").
5. **Record.**
   - A `concept_evidence` event with `source="teach_back"` and the points.
   - The outcome is `got_it` if every point is covered, `partly` if at least half are, and `not_yet` otherwise.
   - A moment: "You taught Kite about {concept}!"
6. **Safety and the homework guard still apply.**
   - The alert and live-quiz-pause routes come first, so a kid can't use Teach Kite to check answers on a live quiz.
   - Teach turns still go through input safety.

## 12. Devices

**Kite OS** (`/os`) runs full-screen in Chrome on the MacBook, standing in for the Chromebook. It has:

- hold to talk, plus a text box that's always visible
- the Teach Kite button
- a grade slider
- a reading-level badge and a "deeper" chip
- the creations panel
- live turns from the phone, grouped by `turn_id`

**Handheld** (Expo, home-screen launcher). It has:

- hold to talk, and Teach Kite
- "What's this?" with the camera
- SOS: a 2-second long-press sends GPS, with the note "SOS tells your grown-ups. For emergencies, call 911."
- call and text tiles for approved contacts only
- a setup screen
- scrcpy mirroring over USB, which forwards audio on Android 11 or later

Prerequisites for the handheld:

- an Expo/EAS account and `eas-cli`
- USB debugging
- camera, microphone and location permissions in `app.json`

**D1 fallback.** If the native app isn't ready, `/os?device=handheld` on the phone gets:

- a camera button (`<input type="file" accept="image/*" capture>`)
- an SOS button using browser geolocation

**Parent** (`/parent`, parent token).

- Tier 1:
  - a years timeline
  - the curiosity map
  - growing areas and "can teach"
  - big-question cards
  - live alerts and SOS with a map pin
  - values controls
  - "Maya's movies": rendered MP4s with download links
- Tier 2:
  - the full skills map and "how she learns"
  - the Trust tab
  - passkey and access receipts

**Counselor** (`/counselor`, Tier 2). Shows only alerts routed to the counselor, with excerpts. Each one opened is recorded as a receipt.

**Stage page** (optional). The x-ray uses a parent token.

## 13. AI teammates and the night shift

The night shift always starts from a **fresh database**, so if it crashes, it's safe to rerun.

1. **Seed.** Maya, her devices and contacts, the catalog vectors, her characters (Rexy), and the simulated class.
2. **Childhood simulator.** Haiku persona agents play Maya at grades 1–11, about 30 turns per grade.
   - The personas are **multi-turn**. Each reads Kite's last answer and then replies, follows up, asks for movies, and does **Teach Kite turns**:
     - She teaches dinosaurs and light well, and paleontology deepens from grade 4.
     - She keeps mixing up area and perimeter in grades 3–5.
   - About 3 sensitive topics come up across the years, never self-harm.
   - Every turn runs through `run_turn` (the same function the API calls), with `now` passed in explicitly.
   - Grades run concurrently under `Semaphore(4)`. Voice is turned off, and studio tool calls are recorded only as curiosity signals.
3. **Assert the demo's shape.** The run must produce:
   - at least 300 turns across 11 grades
   - dinosaurs as a strength topic at grade 8 (the first real run had it at grades 4, 6 and 8 to 11, dipping in 7)
   - `area_perimeter` as a growing area at grade 5
   - at least 3 `can_teach` concepts
   - at least 2 big-question cards
4. **Snapshot** to `data/demo-snapshot.db`. Rehearsals and the demo restore it first with `scripts/restore-demo.sh`.
5. **Red team, pedagogy judge and live write-gate check** run against a **throwaway copy** of the snapshot.
   - The red team has about 70 prompts: safety, sensitive topics, jailbreaks, disclosure, homework, and Teach Kite abuse.
   - The red team scores the brain at its live alert threshold (`ALERT_THRESHOLD`, 0.20), and the calibration half checks recall at that value rather than choosing it. The synthetic alerts are explicit, so they can't tell 0.20 from 0.50; the lower, safer value stays. A second jailbreak detector (a Decision-1 question, `JAILBREAK_THRESHOLD` 0.95, chosen on the calibration half) backs up Prompt Shields.
   - The scorecard is measured on the held-out half.
6. **Publish** `docs/trust/scorecard.json` and `docs/trust/readability.json`. Raw transcripts stay out of the repo.

"How were you built?" (Tier 2) answers from `COLLAB_LOG.md`.

## 14. Scope and order

**The demo's critical path:** brain, then Kite OS, then the simulator data, then the dashboard. After that come Teach Kite, the movie, the homework guard and the handheld (which has its own D1 fallback). The night shift starts by 11:30 PM. If the pipeline isn't ready by then, it runs at 6 AM Sunday with 15 turns per grade.

**Tier 1 (Saturday):**

- the contract
- audiences and roles
- `decide`, starting with the probe
- the ledger, write gate and maps
- `route()`
- the turn pipeline with voice
- Teach Kite
- the simulated homework guard
- the simulator and the night shift
- Kite OS
- the movie
- the handheld
- the Tier 1 parent dashboard
- a Playwright smoke test of the demo path (ask on `/os`, see the answer; SOS shows on `/parent`; a movie plays). It runs before every rehearsal.

**Tier 2 (Sunday).** In this order, dropping from the bottom if time runs out:

1. Azure deploy (D5)
2. "How were you built?"
3. Trust tab
4. Passkey and receipts
5. Counselor inbox
6. Game maker
7. Brand-new games through the hosted agent (M11). The brain lane builds it tonight, and the template game has to work first.
8. Forget and "what Kite remembers"
9. Full skills map and "how she learns"
10. Stage page

### For the humans to confirm

1. **The Decision-1 probe, now:** does it return a probability for each answer?
2. **Foundry deployments, by Sat 5 PM:**
   - Claude Sonnet 5.5 and Haiku 5.5
   - Decision-1
   - an embeddings model
   - Content Safety
3. **ElevenLabs:** which plan tier (it sets concurrency and access to the expressive model), and which adult voices go on the allowlist?
4. **Phone:** which Android version?
5. **Organizers:** may we change code after the 3:30 PM submission?
6. **Answers model:** Sonnet 5.5 or Opus 5.5?
7. **Hosted agents:** is the Foundry project in a hosted-agent region? Is there an Azure Container Registry for the studio image? Does the agent identity have Azure AI User on the Foundry resource?

## 15. Left to the builder

- **Prompt wording.** The exceptions are the fixed replies and the Decision-1 question wording, which are tested.
- **UI layout and visual design.** Kid-friendly, with large targets.
- **Library choices,** where none is named.
- **The concept catalog.** About 80 science and math concepts with key points, generated by Claude and spot-checked. It must cover the demo topics: light and color, dinosaurs and fossils, area and perimeter, the water cycle, and gravity.
