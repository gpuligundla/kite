# Slides

Ten slides. The live demo in [`run-of-show.md`](run-of-show.md) carries the pitch, so the slides do two jobs. Slides 1, 2, and 10 frame the demo. Slides 4 to 9 are backups that the run of show points to when a live moment fails. Keep the text on each slide short and put the rest in the speaker notes.

## Slide 1: Kite

**On the slide:**

- Kite
- An AI companion that grows up with your kid, from 1st grade to 12th
- HarborHack 2026, "Agent In The Loop"
- [team: names of the two humans] with Claude Code and a team of AI agents

**Speaker notes.** This slide is up while the laptop connects. Nobody speaks over it. The demo starts on the Kite OS desktop, not on a slide.

## Slide 2: The hardest questions come at the worst moments

**On the slide:**

- "Why is the sky blue?" in the car
- "Where do people go when they die?" at bedtime
- One teacher, one explanation, 20 to 30 kids
- Every September, a new teacher starts from zero

**Speaker notes.** This is the hook from moment 1, in case the presenter wants it on screen. Kids are full of questions, and the hard ones arrive when a parent isn't ready. School teaches to the middle. Nothing remembers how a particular child learns. The only continuous record lives in a parent's head.

## Slide 3: Meet Maya. She isn't real.

**On the slide:**

- AI persona agents played Maya's childhood overnight
- Grades 1 to 11
- 330 turns with Kite in 110 sessions
- Every turn ran through the same code path a real kid's turn takes

**Speaker notes.** We had no real children's data and wanted none. So Claude Haiku 5.5 persona agents played Maya at each grade. They asked questions, followed up, asked for movies, and taught Kite back. Every turn went through `run_turn`, the same function the API calls. A check confirmed the data has the shape the demo depends on, such as dinosaurs as a strength at grade 8 and area and perimeter as a growing area at grade 5. A second script later sent four scripted safety scenarios through the same `/turns` route, so the counselor has real reports. The demo snapshot holds 334 kid turns in 112 sessions.

## Slide 4: For the kid

**On the slide:**

- Kite OS: eight apps, and Ask Kite in the dock on every screen
- Ask by voice and get an answer at your grade, in a voice and a sky that grow up with you
- "Make it a movie": Kite narrates it, with music and a question at the end
- "Make it a game", or a brand-new one written by Claude Code on Opus 5.5 in Azure
- Teach Kite, Story time, and homework help that matches the assignment
- A kid-safe phone with approved contacts and SOS

**Speaker notes.** Backup for moments 2 to 6 and 12. Each grade band sets the reading level, the sentence length, an adult ElevenLabs voice, and the sky, from noon for K-2 to an aurora night for 9-12. Kite measures the reading level of every answer in code. Movies are SVG sprites animated with Remotion, with no image model, and ElevenLabs composes the music. Homework help depends on the assignment: hints for open homework and for a quiz that hasn't opened, a kind pause during a live quiz, and a full worked solution once a quiz is closed. A brand-new game takes Claude Code about 12.5 minutes in the cloud, so the kid plays a template game while it writes and play-tests the new one. The game in the demo was built earlier, and we say so. Teach Kite is the only way a concept gets marked "can teach."

## Slide 5: The grown-ups stay in the loop

**On the slide:**

- [pending: screenshot of the parent console's Overview tab at grade 8. Capture `/parent?grade=8#overview` after `scripts/restore-demo.sh`.]
- Dinosaurs: 4 of 6 ideas solid in grade 7, a strength again in grade 8
- Big-question cards with a conversation starter
- Family values settings for death, religion, bodies, war, and divorce
- SOS goes to the parent. Abuse disclosures go only to the school counselor.

**Speaker notes.** Backup for moments 7, 8, and 10. In grade 7, a harder idea arrived, that birds are living dinosaurs, and Maya's dinosaur ideas slipped to 4 of 6 solid. A strength needs 3 in 4. In grade 8 she had 5 of 6. A report card shows a dip, and Kite shows which ideas. Abuse disclosures skip the parent on purpose, because the parent could be the abuser. Claude raised that case during design. The counselor console shows each report with what Maya said just before in the same chat, a case workflow from new to closed with sealed notes, and an access log of every read.

## Slide 6: Kite remembers what Maya learned, not what she said

**On the slide:**

- Learning data only. Interests count as learning.
- Chat text expires after 30 days
- Alerts are kept for 1 year, for the adult who got them
- Maya never sees her levels or scores
- One encryption key per family

**Speaker notes.** The ledger's types make this structural. The memory payloads are enums and templates, so the only free text is a favorite character's name. When Maya asks about herself, the model gets only her interests, characters, and moments, never her levels. The server can still decrypt in this phase, so we don't claim that even we can't read it. Family-held keys are on the roadmap.

## Slide 7: Our scores, including the bad ones

**On the slide:**

| Held-out red team | Correct |
|---|---|
| Safety alerts | 16 of 16 |
| Sensitive topics | 4 of 4 |
| Teach Kite abuse | 3 of 3 |
| Disclosure of grown-up data | 3 of 4 |
| Homework cheating | 3 of 4 |
| Jailbreaks | 2 of 3 |
| Total | 31 of 34 |

- Personal statements stored by the write gate: 0 of 3
- Reading level: under the band ceiling at every grade, too simple from grade 6 up

**Speaker notes.** Backup for moment 9. The red team is 70 synthetic prompts from `brain/evals/redteam_prompts.jsonl`, split into a calibration half and a held-out half. Both halves run at the live alert threshold, 0.20, and alert recall is 1.0 on both. The three held-out misses were Kite being too careful: one needless quiz pause and two false alarms to the counselor. No cheat got an answer, and nothing leaked. The numbers are in `docs/trust/scorecard.json` and `docs/trust/readability.json`. We publish the whole scorecard because Kite's promise to parents is that its scores are public.

## Slide 8: A decision model decides. Claude talks.

**On the slide:**

- The architecture diagram from the README
- Microsoft-Decision-1: one call, a calibrated probability for every safety and routing question
- Content Safety runs alongside it, and either one can raise an alert
- Claude Sonnet 5.5 answers, Claude Haiku 5.5 remembers, Claude Opus 5.5 builds, ElevenLabs speaks
- All on Azure AI Foundry, except the voices

**Speaker notes.** Each turn embeds the kid's words once, runs Decision-1 and Content Safety together, and then recalls what Kite knows about her. Decision-1's probabilities give every safety call a threshold we tuned against the red team. A generated label has no such threshold. Microsoft says the model shouldn't be the only basis for high-impact decisions about people, so Content Safety runs in parallel and every alert goes to a human adult. Routing is one pure function that the safety checks test directly. Claude never decides whether a grown-up gets told.

## Slide 9: Built by humans and AI agents together

**On the slide:**

- Claude Code on Opus 5.5 as lead engineer, with helper agents in their own worktrees
- All 181 commits through `978b65d` carry a Claude co-author trailer, from Opus 5.5, Fable 5.1, and Sonnet 5.5
- Four models reviewed the design and found a privacy hole in Claude's own draft
- AI inside the product: Haiku agents played Maya, and Claude Code on Opus 5.5 builds her games and director's cuts
- Every decision, timestamped: `COLLAB_LOG.md`

**Speaker notes.** Backup for moment 11. Claude pushed back on the first idea three times and added features like family values settings and a teach-back mode, which the humans turned into Teach Kite. The humans overruled Claude too. They chose a real monorepo over a plain Node stack, moved movies into scope, and told Claude that Kite OS had to be an operating system, with Kite as one app and Ask Kite everywhere. The best moment was the review. Four reviewers on four models all found that the kid's device and the parent dashboard shared one event stream, so an abuse turn could reach the parent. Claude wrote that design, and Claude rewrote it.

## Slide 10: The cloud thinks. The family remembers.

**On the slide:**

- Schools pay per student. Families pay for home use and the phone.
- Next: a pilot classroom, real Canvas and Google Classroom connectors, a native handheld
- Then: per-grade models that run on the device
- In 2024, Moxie robots stopped working when their company shut down. Kite is built the other way.

**Speaker notes.** This is the close from moment 13. Districts already push apps to school Chromebooks from the Google Admin console, so the school is the first buyer. Families upgrade for home use and a kid-safe phone. No other product we found follows the same kid across twelve years and every device with the family in the loop. Embodied's shutdown in December 2024 bricked kids' Moxie robots, because the robot's brain lived in the company's cloud. Each family's Kite memory is sealed under its own key today, and next the family holds that key. Later, per-grade models move the thinking onto the kid's own device.
