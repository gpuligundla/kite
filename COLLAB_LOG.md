# Collaboration log: humans × non-humans

Timestamped record of how our AI teammates shaped Kite. Source for the Devpost "Non-Human Collaboration Story."

---

## 2026-10-24 09:40 EDT: Session 1, from idea to plan (Claude Code, Opus 5.5)

**What the human brought:** a rough, ambitious idea. A grade-tuned AI companion for K-12 kids, a new AI-native Chromebook OS, a handheld device, lifelong memory, story/video/game learning modes, and a parent and teacher dashboard.

**What Claude did**

- Pulled the HarborHack rules and found two things that changed the plan:
  - One third of the score is non-human collaboration.
  - The submission deadline is Sun 4 PM, before the demo.
- **Pushed back on three things:**
  - Per-grade fine-tuning became grade-conditioned prompting with *measured* reading level.
  - A new OS became an AI-native shell, deployed as a managed ChromeOS app, which is also how districts actually adopt software.
  - A native Android app became one web app on two devices.
- **Added to the vision:**
  - Family-values settings for sensitive topics
  - Conversation starters for parents
  - Graduated teen privacy
  - Homework mode and teach-back mode
  - Curiosity quests and anti-dependency design
  - A family-owned learning passport
  - The Moxie shutdown as the case for on-device
- **Proposed more AI teammates:** synthetic-kid persona agents to generate a simulated childhood, a red-team agent, and a pedagogy judge.

**Still for the humans to decide:** who the second human is, which API keys we have, which demo hardware we use, the stack, and the name.

## 2026-10-24 10:00 EDT: Session 1, the humans push back

- **The humans overrode Claude's minimal-stack recommendation.** Claude had proposed plain Node and HTML. They chose "real engineering, not a simulator," because judges read the codebase.
- **Animated video moved from roadmap into scope.**
- **Claude redesigned the plan around those calls:**
  - A TypeScript monorepo with a separate brain service
  - A native Android launcher option, with a 2 PM fallback checkpoint
  - One storyboard engine that renders to movie, book, and game
  - An overnight AI "night shift" that runs the childhood simulator and red team
- **Claude flagged a conflict to the humans:** "native app → slides" and "not a simulator" pull in opposite directions. It's left as decision D1 for the team.
- Published a team review page so the two humans can decide together.

## 2026-10-24 ~10:20 EDT: Session 1, the safety and memory design

- **The human asked what risks Kite poses to kids.** Claude argued the biggest risks aren't bad answers. They are:
  - the 12-year profile itself
  - emotional dependency
  - alerts reaching the wrong adult
- **Claude caught a non-obvious failure mode:** an abuse disclosure that alerts the parent can endanger the kid when the parent is the abuser. Abuse disclosures now route to the school counselor.
- **The human proposed "cloud now, on-prem later with physical 2FA."** Claude sharpened it:
  - The framing became "the cloud thinks, the family remembers," with a phased path to family-held keys.
  - "Physical 2FA" became FIDO2 passkeys.
  - Memory is split into learning, personal, and safety tiers.
  - The kid can say "Kite, forget that."
- **Claude also set an honesty rule for the pitch:** don't claim "even we can't read it" until family-held keys exist.

## 2026-10-24 ~10:35 EDT: Session 1, Claude reverses itself on Jev; the humans set "keep it lean"

- **The human suggested two new tools:**
  - Tavus, for real-time face-to-face video agents
  - TypeSafe's Jev, a fast model that returns typed decisions
- **Claude first recommended Jev for safety triage, then reversed itself.** If the safety check runs in parallel with Claude's answer, it finishes before the first spoken sentence, so Jev's speed advantage disappears. A 5-week-old API isn't worth the risk in a live demo.
- **Claude judged Tavus a poor fit for young kids.** A lifelike human face invites attachment, and it streams continuous video of a child's face to a third party. It could work as an opt-in teen "practice partner." Both tools moved to the roadmap slide.
- **The human set the constraint "don't bloat the project," with a 5–6 minute demo.** Claude cut Tier 3 and the storybook, and timed the demo script to the second.

## 2026-10-24 ~10:45 EDT: Session 1, staging the presentation

- **Claude proposed making Kite a visible, audible third presenter:**
  - A cold-open montage of Maya's simulated childhood
  - A three-way stage view with a live "x-ray" of each agent turn
  - A judge playing the kid
  - Kite closing the show with lessons learned
- **One requirement moved into Tier 1:** the brain emits an event for every step of a turn.
- The humans deferred the final staging choice to Sunday.

## 2026-10-24 ~12:35 EDT: Session 1, the humans question the device strategy

- **The human doubted the handheld and the "OS" framing:**
  - Kids get their own phone around 12–13.
  - Many schools give K–2 iPads, not Chromebooks.
  - The teammate proposed "an app on every device, OS-level on the Chromebook," and the human felt that wasn't coherent.
- **Claude checked the facts.** The median first smartphone is at about age 11. The common district pattern is iPads for K–2 and Chromebooks for grades 3–12.
- **Claude reframed the devices as "surfaces by age":**
  - The product is the companion and the kid's learning profile. The device changes as the kid grows.
  - Where an adult manages the device (school Chromebook, kid handheld), Kite is the whole screen. Where the kid owns the device, Kite is an app.
  - Under that rule, the teammate's proposal is coherent.
- **The human proposed an education-only cloud profile.** The school creates it at enrollment, and safety hooks on live chat alert parents and teachers. Claude endorsed it as simpler than its own three-tier memory design ("Kite remembers what Maya learned, not what she said") and flagged three gaps:
  - Interests must count as learning data, or personalization dies.
  - "The school creates it" has to fit with "the family owns it."
  - The parent's view of past chats needs a retention window.
- **Claude told the humans none of this changes the weekend build** and asked them to lock decisions D1–D6.

## 2026-10-24 ~13:30 EDT: Session 1, the humans lock decisions; chat retention settled

- **The humans locked:**
  - D1: the native Android launcher.
  - D2: our own animation pipeline.
  - D3: hold to talk.
  - D4: TypeScript for the UIs and **Python for the brain**. This changed Claude's plan, which had the brain in TypeScript.
  - D5: develop locally behind a tunnel, deploy to Azure on Sunday.
  - D6: no fixed ownership split.
- **The human settled two memory questions:**
  - Interests count as learning data.
  - The school sets up the profile, and the family owns it.
- **The human proposed keeping chats as an audit backup until the end of each grade,** and asked Claude to consult its advisor model and pick.
- **Claude and the advisor picked a rolling 30-day window instead.** Their reasons:
  - Per-grade retention would keep a September chat for 10 months.
  - It would break the pitch line "Kite remembers what Maya learned, not what she said."
  - The 2025 COPPA amendments require a written retention period tied to a purpose.
- **The audit needs are still covered:**
  - Parents can review chats inside the 30-day window.
  - Safety alerts keep the flagged message and the turns around it on a restricted path for 1 year.
  - Learning facts are saved to the profile before a chat expires.

## 2026-10-24 ~13:45 EDT: Session 1, Claude changes its mind on a decision model; memory gets concrete

- **The human asked to use Microsoft-Decision-1 for classification and routing instead of a Claude model.**
  - Decision-1 is a Microsoft scoring model released Oct 9, 2026. It returns calibrated probabilities over a fixed set of answers.
- **Claude reversed its morning position.** It had rejected Jev on latency, and the case for Decision-1 is different:
  - A calibrated probability gives a threshold we can tune toward catching every real alert, calibrated against the red-team set. A generated label has no dial.
  - It runs on Azure under terms the team already has.
  - One call returns several typed decisions.
  - The architecture becomes "a decision model decides, Claude talks."
- **Claude held one line from Microsoft's own caveat** that the model shouldn't be the sole basis for high-impact decisions about people:
  - Azure Content Safety runs in parallel, and either one can escalate.
  - Every alert goes to a human adult.
  - A Claude fallback returns the same labels if the 2-week-old API fails.
- **The human asked for skills and curiosity maps** to help adults support weak areas and give the kid freedom in organic interests. Claude surfaced the hidden brain change: grade becomes a floor for tone and safety, not a ceiling for depth.
- **The human asked about mem0 and Supermemory. Claude recommended against both:**
  - They store free-text facts about the user, which is what Kite deliberately doesn't keep.
  - Kite's memory is mostly structured.
  - The hosted versions add another custodian of children's data.
- **Claude proposed an append-only, grade-stamped learning ledger instead,** with per-family envelope encryption and devices that hold no memory.

## 2026-10-24 ~14:45 EDT: Session 1, a design review by a fresh agent; two new human requirements

- **Claude wrote the locked design and had a fresh reviewer agent read it cold, as the builder would.** The reviewer raised seven questions. Claude settled five of them in the design:
  - The demo's critical path.
  - Counselor alerts get a small inbox in Tier 2.
  - SQLite stays on the container's local disk, because SQLite on Azure Files is unreliable.
  - Rexy's character art is cached per kid, so movies start faster.
  - A note on Remotion's license.
- **Two of the reviewer's questions went back to the humans:**
  - Whether code may change after the 3:30 PM submission.
  - Which Azure services exist. Some have to be fixed before the night shift.
- **The human added two requirements mid-planning:**
  - Kite must not tell the kid their own profile analytics.
  - Kite must connect to Canvas-style school platforms: help with open homework instead of answering it, and fully explain closed assignments and exams.
- **Claude made the first requirement structural, not just a prompt rule.** Claude never receives levels or scores, only teaching guidance. "Tell me about me" turns see only the kid's interests, characters and learning moments.
- **Claude added a third homework state the human hadn't named:** a quiz that's live right now gets a kind pause and no help at all. It also added disclosure and homework attacks to the red team.

## 2026-10-24 ~15:15 EDT: Session 1, a four-model adversarial review rewrites the design

- **The human asked Claude to review the design and plan with pstack's `interrogate`.** Four reviewers on different models (Opus, Fable, Sonnet, Haiku) read the documents independently.
- **All four found the same top problem.** The kid's device and the parent dashboard shared one live stream and one kind of token. That made two headline claims false at the API:
  - "abuse never reaches the parent"
  - "the kid never sees the grown-up view"
  Claude had written that design.
- **Three or more reviewers also agreed that:**
  - Audio and movie files couldn't authenticate in a browser.
  - The overnight simulation would produce no skills evidence, so the dashboard's growing areas and the "deeper" answers would never appear.
  - Rehearsal turns would pollute Maya's memory.
  - `calibrate()` would always pick the lowest threshold.
  - The write-gate test didn't test the gate.
- **Claude reversed its own design on six points:**
  - Every event now has an audience, and every device has a role.
  - Speech arrives inline, and the web app reaches the brain through a same-origin proxy.
  - Time-travel turns are read-only.
  - Mastery evidence comes only from what the kid shows: Teach Kite, check questions and games, never Kite's own answers.
  - Routing is one pure function.
  - Memory types are structural (topic enums and templated moments) instead of free text.
- **Deleted along the way:** the audio route, the reconcile question, per-token streaming, the concept table and a fake schema route.
- **The humans added requirements during the revision:**
  - All models on Azure Foundry, and all voice on ElevenLabs, adapting to grade and situation.
  - An Einstein-inspired "Teach Kite" mode, in which the kid explains and Kite listens, then celebrates or helps.
  - A simulated homework class, because there are no LMS APIs.
  - Games and movies built from SVG with JS libraries. Movies render to a real MP4 with ElevenLabs audio.
  - Use Playwright or similar.
- **Teach Kite also fixed the evidence gap the reviewers found.** Claude used the SVG decision to drop the image model entirely. Claude chose Remotion's renderer for video (it drives headless Chrome itself) and Playwright for an end-to-end demo smoke test.
