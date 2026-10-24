# HarborHack 2026: what we build

> **v1, superseded.** The locked design is `docs/superpowers/specs/2026-10-24-kite-hackathon-design.md`.

## The rules that shape everything

- **Devpost deadline: Sun Oct 25, 4:00 PM EDT.** That's the hard stop for the repo and write-up. The live demo is Sunday night, after the deadline. We have about 30 hours from Sat 10 AM.
- **The team needs 2 or more humans plus at least 1 non-human.**
- **Scoring is three equal thirds:**

| Criterion (1/3 each) | What judges look for | How we win it |
|---|---|---|
| **Value** (commercial and/or social) | "Could this really work? Does it do good?" | K-12 education plus child safety is high social value. A school-and-family business model with named comparables. The safety and privacy story. |
| **Achievement** | "How much did you build, at what quality? A web app beats slides." | A real, working app on **two physical devices** sharing one brain, a live voice demo, games generated live, and a dashboard full of real data |
| **Non-human collaboration** | "Was a non-human a serious contributor? Creative or experimental approaches get bonus points." | **Four AI teammates with named jobs** (below), a timestamped `COLLAB_LOG.md`, and the product itself explaining on stage how it was built |

- **Submission must include:** name, a 2–5 paragraph description (problem, solution, challenge, what's unique), a public GitHub repo, and a **Non-Human Collaboration Story** (which AIs, how responsibilities evolved, where the AI influenced the design, what surprised us, what didn't work).
- **The live demo must show:** the problem, the solution, the role of the synthetic teammate, and lessons learned.

## The demo we're building toward

**The story we tell:** follow one kid, Maya, through her school years. Same companion, same memory, growing with her.

1. **Chromebook, Maya in 2nd grade.** She asks by voice, "Why is the sky blue?" Kite answers with a short story starring Rexy, her T. rex (it remembers Rexy). She taps **"Make it a game,"** and about 20 seconds later a judge is playing a game about catching blue light.
2. **Time travel.** Drag the grade slider to 7th grade and ask the same question. Kite explains light scattering with soccer and says, "Remember when Rexy chased the blue light?" Drag to 11th grade: Rayleigh scattering, 1/λ⁴, and a Socratic nudge. A badge shows the **measured** reading level of each answer.
3. **Handheld (Android phone).** Ask "Kite, what's this?" and snap something on the judges' table. Then press **SOS**, and the laptop's parent dashboard lights up with the location.
4. **Parent dashboard.** Ten simulated years of Maya: curiosity map by grade, strengths, and growing areas. One card reads "Maya asked about death in 3rd grade. Here's what Kite said, and here's a conversation starter." Flip a family-values setting and the next answer changes live.
5. **Agent in the loop.** Show the team roster, including the AI teammates and their numbers. Then ask Kite live, "How were you built?" It answers from `COLLAB_LOG.md`.
6. **Close.** Who pays (districts and families), the on-device future (the Moxie lesson), and lessons learned.

## Our non-human teammates (one third of the score, so we make it visible)

| Teammate | Job | Evidence we show |
|---|---|---|
| **Claude Code (builder)** | Architecture and code. Pushed back on design (no fine-tune, no OS rewrite, no Android app) and added features (values settings, teach-back, graduated privacy) | `COLLAB_LOG.md`, the commit history, VISION.md's "where the AI shaped this" section |
| **Synthetic Maya (persona agents)** | "Lives" grades 1–11 in one evening, generating realistic questions at each age. Those run through Kite to create real transcripts and memories | The dashboard data. *"Maya grew up overnight: N conversations, 11 grades."* |
| **Red-team agent** | Attacks Kite with sensitive and adversarial kid prompts: self-harm, strangers, jailbreaks, "don't tell mom" | Safety scorecard: *"X/Y handled correctly"* |
| **Pedagogy judge** | Checks that each answer fits the grade, with Flesch-Kincaid reading level computed in code | Chart of target grade vs measured reading level |

Keep a running **`COLLAB_LOG.md`** with timestamped entries for each moment where the AI changed a decision, failed, or surprised us. It becomes the Devpost collaboration story almost verbatim.

## Scope

**P0: must work by Sat midnight**

- **Kid "OS" shell** (full screen on a laptop or Chromebook). The companion is front and center, with Ask by chat and voice and a grade slider.
- **Grade-adaptive answers** from a per-grade-band policy, combined with the kid's memory.
- **Memory:** stored per kid. After each exchange, a cheap model call pulls out lasting facts and moments.
- **Storybook mode:** pages with narration. Illustrations are SVG that Claude draws, or an image API if we have a key.
- **Game mode:** Claude writes a single-file HTML game, which runs in a sandboxed iframe.
- **Synthetic childhood script** that seeds Maya's grades 1–11.
- **Parent dashboard:** curiosity map, strengths and growing areas, transcripts, alerts, controls.
- **Safety layer:** a classifier on every kid message that marks it ok, a big question, or a safety alert. It feeds alerts and the family-values policy.

**P1: Sunday morning**

- **Phone shell** (the same web app installed on Android): push-to-talk, "Show me" camera plus vision, SOS with geolocation sent to the dashboard. Phone, SMS, and maps are tiles that open the native apps.
- **Evals runner:** reading-level chart and red-team scorecard.
- **"Ask Kite how it was built"** mode.
- **Demo-mode fallback:** a cached story and game in case the venue wifi or the API is slow.

**Cut (say so on stage as roadmap)**

- Fine-tuning
- A real OS or Linux image
- A native Android app
- Animated video
- Real SMS or calls
- Login and multiple families
- Teacher class view (one mock card at most)
- On-device model

## Architecture (default, swap if the team prefers another stack)

```
one Node 24 server (already installed): no build step
├── /os        kid Chromebook shell        (plain HTML/JS)
├── /phone     handheld shell, installable web app (same JS, phone layout)
├── /parent    dashboard                    (plain HTML/JS + Chart.js from CDN)
├── /api/chat     {kidId, text, device, image?} → answer + safety flags
├── /api/create   {kidId, topic, mode: story|game} → content
├── /api/sos      {kidId, lat, lng}
├── /api/parent/:kidId   → dashboard data
└── node:sqlite (built into Node 24): kids, messages, memories, alerts, creations
```

- **LLM:** Claude. A Sonnet-class model for answers and game and story generation, a Haiku-class model for the classifier and memory extraction. Vision for "Show me."
- **Voice:** the browser's built-in Web Speech API (speech-to-text and text-to-speech) in Chrome on both devices. No extra service needed. Upgrade to ElevenLabs only if we already have a key.
- **Phone needs HTTPS** for the mic, camera, and GPS. Use a `cloudflared` quick tunnel (single binary, not installed yet) or a one-click deploy.

## Schedule (EDT)

| When | What | Who |
|---|---|---|
| Sat 10–11 | Answers to open questions, keys, skeleton server running | You + Claude |
| Sat 11–14 | Kid shell, Ask (chat + voice), grade slider, memory | You + Claude |
| Sat 14–17 | Storybook and game modes | You + Claude |
| Sat 11–17 | Parent dashboard UI, pitch outline, name and logo | Teammate (+ their own Claude session) |
| Sat 17–20 | Synthetic childhood script, seed Maya, connect the dashboard | Both |
| Sat 20–23 | Safety layer, big-question alerts, values controls | Both |
| Sun 08–10:30 | Phone shell, camera, SOS, tunnel | You + Claude |
| Sun 08–10:30 | Evals runner (reading level, red team) | Teammate + Claude |
| Sun 10:30–12 | Polish, "how were you built" mode, demo fallbacks | Both |
| Sun 12–14:30 | README, Devpost write-up, collaboration story, screenshots, **backup demo video** | Teammate + Claude |
| **Sun 15:30** | **Submit** (30 minutes of buffer before the 16:00 deadline) | Both |
| Sun evening | Rehearse twice, then demo | Both |

## Risks and fallbacks

| Risk | Fallback |
|---|---|
| Venue wifi drops | Phone hotspot, plus cached demo responses |
| Voice fails in a noisy room | Typed input always visible, and hold the phone close |
| Game generation is slow or broken | Pre-generated "sky is blue" game cached, and a regenerate button |
| Model says something bad on stage | The safety layer runs before display, and we rehearse only tested prompts |
| Running out of time | P1 items are independent. Drop them in reverse order and the story still holds |
