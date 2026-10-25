# Devpost submission: Kite

Paste each section into the Devpost field with the same name. Every placeholder in square brackets needs the lead's answer before submitting. The red-team and reading-level numbers come from `docs/trust/` and may change tonight.

## Project name

Kite

## Tagline

An AI companion that grows up with your kid from 1st to 12th grade, and keeps the grown-ups in the loop.

## Try it out

- Code: [pending: public GitHub repo URL]
- Live app: [pending: deploy URL]
- Demo video: [pending: backup demo video URL]

## Inspiration

Kids ask the hardest questions at the worst moments. "Why is the sky blue?" comes up in the car, and "Where do people go when they die?" comes up at bedtime. Parents often don't know the answer, or don't know how to say it to a seven-year-old.

School can't fill that gap alone. One teacher explains one way to 20 or 30 kids. Some kids learn through stories and some through play, and most get a worksheet. Nothing remembers the child either. Every September a new teacher starts from zero, and every learning app is a fresh login with no history.

We also had a warning to design against. In December 2024, Embodied shut down, and its Moxie companion robots stopped working because each robot's brain lived in the company's cloud. Kids lost their companion overnight. We wanted a companion whose memory belongs to the family and whose future runs on the kid's own device.

## What it does

Kite is one companion that follows a kid across every grade. This weekend's build shows it with Maya, a simulated kid whose childhood AI agents played from grade 1 to grade 11. The brain behind every feature below is built, and its safety checks pass. [pending: the web app pages that show these features]

**For the kid:**

- Ask anything by voice and hear an answer pitched to your grade. Each grade band (K-2, 3-5, 6-8, 9-12) sets the reading level, the sentence length, the style, and an adult ElevenLabs voice that gets steadier as the kid grows. Kite measures the reading level of every answer in code.
- Drag a grade slider to ask the same question at another grade. Time-travel turns are read-only, so they never change the kid's memory.
- Say "make it a movie" to get a narrated cartoon of up to five scenes, built from SVG sprites and voiced by ElevenLabs. It plays in the browser and renders to an MP4 for the parents.
- Say "make it a game" to get a small KAPLAY game about the idea. Tap "Build me a brand-new one!" and Claude Code, running in a sandbox in Azure, writes a new game from scratch and play-tests it before the kid sees it.
- Teach Kite. The kid explains an idea while Kite listens without interrupting. Kite grades the explanation against the concept's key points, then celebrates or asks one guiding question about what was missed.
- Get homework help that matches the assignment. Open homework gets hints, a live quiz gets a kind pause, and a closed quiz gets the full worked solution. The class is simulated in Canvas's assignment format, because no LMS connector exists yet.
- Say "Kite, forget that" to delete the last turn, and see what Kite remembers.
- On the phone, press SOS to send your location to your parents. [pending: the phone's handheld mode in the web app]

**For the grown-ups:**

- A parent dashboard shows the curiosity map, skills, growing areas, the concepts the kid can teach, and the movies the kid made, at any grade. [pending: the web dashboard]
- Big-question cards tell parents when the kid asked about something like death, what Kite said, and how to continue the talk at home.
- Family values settings decide, for death, religion, bodies, war, and divorce, whether Kite answers, answers and tells the parents, or says to ask a parent.
- Safety alerts for bullying, strangers, and self-harm go to the parent. Abuse disclosures go only to the school counselor, because the parent could be the abuser. [pending: the counselor page]
- A Trust tab publishes Kite's red-team and reading-level scores, including the bad ones.

**What Kite keeps.** Kite remembers what the kid learned, not what they said. It stores learning data only, and interests count as learning data. Chat text expires after 30 days. Alerts are kept for 1 year on a restricted path. The kid never sees levels or scores. When the kid asks about themselves, the model doesn't even receive them.

## How we built it

**The brain** is a Python 3.12 FastAPI service. Each turn runs three calls in parallel. Microsoft-Decision-1 on Azure AI Foundry answers all of the turn's classification questions in one call, with a calibrated probability for each answer. Azure AI Content Safety and Prompt Shields check the input. Recall loads the kid's view, the teaching guidance, and recent turns. A pure function, `route()`, then picks one route in a fixed order: alert, live-quiz pause, ask a parent, Teach Kite, homework, about me, or answer. Claude Sonnet 5.5 on Foundry streams the answer sentence by sentence. Each sentence passes Content Safety again before ElevenLabs Flash speaks it. Our rule is that a decision model decides and Claude talks.

**Memory** is an append-only, grade-stamped learning ledger in SQLite. Every sensitive column is sealed with AES-256-GCM under a per-family key. The payloads are enums and templates, so the only free text the ledger can hold is a favorite character's name. Claude Haiku 5.5 proposes facts with typed output, and a Decision-1 gate drops anything that isn't learning data. If the classifier falls back to another backend, the gate stores nothing.

**Movies** are one Remotion composition. Claude writes the storyboard, and ElevenLabs v3 voices it. `@remotion/player` plays it in the browser, and the same composition renders to an MP4 in the background.

**Brand-new games** run on a Foundry hosted agent called `kite-studio`. Its Python handler starts the Claude Agent SDK, which runs Claude Code against Claude Sonnet 5.5 on Foundry with the agent's own Entra identity. In a fresh VM sandbox, Claude Code writes a single-file KAPLAY game and runs a Playwright play-test until it passes. The brain then checks every string in the game with Content Safety and serves it in a sandboxed iframe with no network access. Everything except ElevenLabs bills through one Azure subscription.

**The web app** is Next.js, and the browser talks to the brain through a same-origin proxy. A shared TypeScript client gets its types from the brain's Pydantic models through OpenAPI. Each device has a kind (`os`, `handheld`, `parent`, or `counselor`), and every event carries an audience, so a kid's device can't subscribe to grown-up events. [pending: the web app's pages]

**The night shift** is how a kid with no real data gets eleven years of history. Claude Haiku 5.5 persona agents played Maya at each grade through the same `run_turn` function the API calls. The run produced 330 turns in 106 sessions across grades 1 to 11, and a demo-shape check confirmed the data the demo depends on. A red team of 70 synthetic prompts, a reading-level judge, and a live write-gate check then ran against a throwaway copy. They publish `docs/trust/scorecard.json` and `docs/trust/readability.json`.

**Infrastructure** is Bicep. `infra/deploy.sh` creates the Foundry account, the four model deployments, Content Safety, the project for the hosted agent, the container registry, and Application Insights. [pending: brain and web on Azure Container Apps]

**The team** was two humans and several AI agents. [team: names and roles of the two humans] Claude Code on Opus 5.5 was the lead engineer. It ran each work item through pstack's poteto-mode playbooks, with helper agents in separate git worktrees. The Non-Human Collaboration Story below has the details, and `COLLAB_LOG.md` has the timestamped record.

## Challenges we ran into

- **Privacy claims that were only true in the prompt.** Our first design gave the kid's device and the parent dashboard one shared event stream and one kind of token. That made "abuse never reaches the parent" false at the API. A four-model review caught it. The fix was structural. Every event now has an audience, every device has a kind, and one dependency checks every endpoint.
- **A simulated kid who wouldn't show what she knew.** Mastery evidence comes only from what the kid shows, through Teach Kite, movie check questions, and games. Halfway through the first night shift, Claude read the half-built database and found 3 skill-evidence events after six grades. The Haiku persona almost never chose to teach back. Claude scheduled a short lesson into two of every three sittings and proved the fix on real services before the rerun.
- **A rule that read the data wrong.** A rehearsal failed because one dinosaur concept sat at "learning" while the others were mastered, and the rule required every concept to be mastered. We changed it to at least 2 mastered concepts making up at least 75% of the topic. Then the real run showed dinosaurs dipping in grade 7, at 3 of 6 concepts mastered. We kept the data and moved the demo to grade 8, where the claim is true.
- **A coding agent that crashed before writing a line.** The first call to the hosted agent returned only "Failed to forward request." Claude read the agent's Application Insights traces and found a `PermissionError`. Foundry sets `HOME` to a session folder the image's user can't write to. One writable work folder fixed it.
- **Deploy surprises.** Azure rejects deployment names that contain "Microsoft", and Decision-1 is offered only as `DataZoneStandard`. Our own deploy found both, and the docs now say so.

## Accomplishments that we're proud of

- Claude Code built a playable kids' game inside an Azure sandbox, billed through Azure. It read the kit, planned the game, wrote it, and ran the play-test until it passed. We re-ran the play-test on the returned file and checked screenshots independently.
- The safety checks are code. `brain/scripts/check_safety.py` prints `ok` for 63 named checks, including that an abuse turn is invisible to the parent and that the kid-view endpoint returns no skills.
- On the held-out red-team prompts, every safety alert fired, 16 of 16, for an alert recall of 1.0. The live write-gate check stored 0 of 3 personal statements. [pending: final scorecard numbers]
- An AI-simulated childhood of 330 turns over eleven grades, run through the same code path a real kid's turn takes.
- A narrated movie that goes from a kid's request to a storyboard, ElevenLabs voices, a browser player, and an MP4.

## What we learned

- **Put privacy in the types, not the prompt.** "Don't tell the kid their scores" is a weak instruction. A model that never receives the scores can't leak them.
- **A calibrated probability gives you a setting to tune.** Decision-1's probabilities let us choose an alert threshold against a red team. A generated label offers nothing to tune.
- **Read the run while it's running.** Waiting for the night shift to finish would have cost 45 minutes and a failed check.
- **Different models catch different things, and agreement is the strongest signal.** All four reviewers independently found the same top problem.
- **Look at the output, not the exit code.** A movie render exited cleanly with captions that ran words together ("on asunnyday"). We found it by looking at the frames.
- **Our own scores show what to fix.** From grade 6 up, Kite's answers read below the band's target range, and the homework guard stopped 1 of 4 held-out cheating attempts.

## What's next for Kite

- Fix the weak spots the Trust tab shows: the homework guard, jailbreaks, and answers that read too simply for older kids.
- A pilot with one classroom and one group of families, with consent flows, standards mapping, and a teacher view.
- Real Canvas and Google Classroom connectors. The simulated class already uses Canvas's assignment format, so a connector replaces one function.
- A native handheld, starting from the Expo launcher that is only a scaffold today, and later dedicated hardware.
- Smaller per-grade-band models distilled for on-device use on Chromebook Plus NPUs.
- Family-held keys, so the cloud keeps only a backup it can't read. Until then, we don't claim "even we can't read it."

## Built with

Python, FastAPI, Pydantic, uv, SQLite, cryptography (AES-256-GCM), textstat, TypeScript, Next.js, React, Node.js, Remotion, KAPLAY, Playwright, openapi-typescript, Azure AI Foundry, Claude Sonnet 5.5, Claude Haiku 5.5, Microsoft-Decision-1, Azure AI Content Safety, Prompt Shields, text-embedding-3-small, Foundry hosted agents, Claude Agent SDK, Claude Code, ElevenLabs Scribe, ElevenLabs Flash, ElevenLabs v3, Azure Container Registry, Application Insights, Bicep, Microsoft Fluent Emoji. [pending: add Azure Container Apps once deployed]

## Non-Human Collaboration Story

### Which AIs took part

- **Claude Code on Opus 5.5, the lead engineer.** It turned a rough idea into a design and a plan, wrote and integrated code, coordinated the helpers, and ran the real systems.
- **Claude helper agents on other models.** Each worked in its own git worktree. Claude Fable 5.1 built the turn pipeline and the `kite-studio` hosted agent. Claude Sonnet 5.5 built the movie and game backend and, on the teammate's branch, the shared TypeScript client. On Saturday evening, three helpers built the parent dashboard view, the movie and game packages, and the studio backend in parallel.
- **Every commit was a collaboration.** All 66 commits through `eb6229d` carry a Claude co-author trailer: 57 from Opus 5.5, 6 from Fable 5.1, and 3 from Sonnet 5.5. [pending: recount at the submission tag with `git log --format='%(trailers:key=Co-Authored-By,valueonly)' | sort | uniq -c`]
- **A review panel.** A fresh reviewer agent read the design cold, the way a builder would. Then four reviewers on Opus, Fable, Sonnet, and Haiku attacked it independently. Claude also consulted an advisor model on the chat-retention decision.
- **AI teammates inside the product.** Claude Haiku 5.5 persona agents played Maya's childhood. Claude Code inside the `kite-studio` hosted agent writes brand-new games. Kite itself answers "how were you built?" from our collaboration log.

### How responsibilities changed

In the morning, Claude was a planner. It read the HarborHack rules and found that one third of the score is collaboration and that the submission deadline comes before the demo. By early afternoon it was a design partner, arguing about safety and memory with the humans. After the humans moved the work onto pstack, Claude became the lead. It sent helpers into separate worktrees and kept a decision trail. By evening it was operating real systems. It read a half-built database, an agent's Application Insights traces, and rendered movie frames. It also merged three helpers' work on a separate branch, so the night shift running in the human's checkout was never disturbed.

The in-product agents took on jobs no human could do in a weekend. They lived eleven years of a childhood overnight and write new games on demand.

### Where the AI shaped the design

- Claude pushed back three times on the first idea. Per-grade fine-tuning became grade-conditioned prompting with a measured reading level. A new Chromebook OS became a full-screen app that schools can deploy. A native Android app became one web app on two devices. The humans later reversed that last call, and the build ended up using the web app on the phone anyway.
- Claude saw that an abuse alert sent to a parent can endanger a kid when the parent is the abuser. Abuse disclosures now go to the school counselor.
- The human proposed keeping chats until the end of each grade. Claude and an advisor model chose a rolling 30-day window instead. Per-grade retention would keep a September chat for 10 months, and the 2025 COPPA amendments require a retention period tied to a purpose.
- Claude made "the kid never sees their own analytics" structural. Claude never receives levels or scores, only teaching guidance.
- Claude added a third homework state the human hadn't named. A quiz that is live right now gets a kind pause and no help.
- Claude recommended against mem0 and Supermemory, because they store free-text facts about the user, which Kite deliberately doesn't keep.

### Where the humans shaped it

- The humans rejected Claude's plain Node and HTML stack because "judges read the codebase," and chose a TypeScript monorepo with a Python brain.
- They moved animated movies from the roadmap into scope, required every model to run on Azure and every voice on ElevenLabs, and added Teach Kite.
- They proposed the education-only cloud profile, which Claude endorsed as simpler than its own three-tier memory design.
- They asked whether a real coding agent could build games on the fly, with Azure billing only. That question led to the hosted agent.
- They dropped the unit-test suite for the hackathon. Claude argued to keep three small checks, because the claims we make on stage depend on them.

### What surprised us

- All four reviewers, on four different models, found the same top problem, and it was in Claude's own design. Claude reversed itself on six points.
- Claude changed its mind twice about decision models, for different reasons. It rejected one model because a parallel safety check made its speed advantage disappear. It accepted Decision-1 because a calibrated probability gives a threshold to tune.
- A helper agent overruled the spec and was right. The parent had to stop subscribing to kid events, because the kid's own words go out before routing and would leak an abuse turn to the parent.
- The dip in Maya's grade 7 dinosaur skills came from the simulation itself. Nobody scripted it.

### What didn't work

- The first night shift would have failed its own check. The persona playing Maya almost never taught back, so after six grades there were only 3 skill-evidence events.
- The first strength rule failed a rehearsal, and the first demo-shape check asked for grade 7 and failed after an hour of simulation.
- An earlier helper left two of the spec's conditions out of the strength rule. A later helper found it, and the lead fixed it.
- The first call to the game-building agent crashed on a folder it couldn't write to.
- The native Android launcher didn't land. The phone runs the web app's handheld mode in its browser. [pending: confirm for the final build]
- The red team still beats the homework guard 3 times in 4 and jailbreaks 2 times in 3, and answers for older kids read too simply. [pending: final scorecard numbers]
