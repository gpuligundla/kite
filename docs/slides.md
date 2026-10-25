# Slides

Ten slides. The live demo in [`run-of-show.md`](run-of-show.md) carries the pitch, so the slides do two jobs. Slides 1, 2, and 10 frame the demo. Slides 4 to 9 are backups that the run of show points to when a live moment fails. Keep the text on each slide short and put the rest in the speaker notes.

## Slide 1: Kite

**On the slide:**

- Kite
- An AI companion that grows up with your kid, from 1st grade to 12th
- HarborHack 2026, "Agent In The Loop"
- [team: names of the two humans] with Claude Code and a team of AI agents

**Speaker notes.** This slide is up while the laptop connects. Nobody speaks over it. The demo starts on Kite OS, not on a slide.

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
- 330 turns with Kite in 106 sessions
- Every turn ran through the same code path a real kid's turn takes

[pending: confirm 330 and 106 against the snapshot that ships]

**Speaker notes.** We had no real children's data and wanted none. So Claude Haiku 5.5 persona agents played Maya at each grade. They asked questions, followed up, asked for movies, and taught Kite back. Every turn went through `run_turn`, the same function the API calls. A check confirmed the data has the shape the demo depends on, such as dinosaurs as a strength at grade 8 and area and perimeter as a growing area at grade 5.

## Slide 4: For the kid

**On the slide:**

- Ask by voice and get an answer at your grade, in a voice that grows up with you
- "Make it a movie": a narrated cartoon starring your characters
- "Make it a game", or a brand-new one written by Claude Code in Azure
- Teach Kite: you explain, Kite listens
- Homework help that matches the assignment

**Speaker notes.** Backup for moments 2 to 6. Each grade band sets the reading level, the sentence length, and an adult ElevenLabs voice. Kite measures the reading level of every answer in code. Movies are SVG sprites animated with Remotion, with no image model. Homework help depends on the assignment: hints for open homework, a kind pause during a live quiz, and a full worked solution once a quiz is closed. We expect a brand-new game to take 1 to 3 minutes, so the kid plays a template game while Claude Code writes and play-tests the new one. Teach Kite is the only way a concept gets marked "can teach."

## Slide 5: The grown-ups stay in the loop

**On the slide:**

- [pending: screenshot of the parent dashboard at grade 8]
- Dinosaurs: a dip in grade 7, a strength again in grade 8
- Big-question cards with a conversation starter
- Family values settings for death, religion, bodies, war, and divorce
- SOS goes to the parent. Abuse disclosures go only to the school counselor.

**Speaker notes.** Backup for moments 7 and 8. In grade 7, Maya's dinosaur teach-backs slipped to 3 of 6 concepts mastered when harder ideas arrived. In grade 8 she had them back. A report card shows a dip, and Kite shows which ideas. Abuse disclosures skip the parent on purpose, because the parent could be the abuser. Claude raised that case during design.

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
| Jailbreaks | 1 of 3 |
| Homework cheating | 1 of 4 |

- Personal statements stored by the write gate: 0 of 3
- Reading level: under the band ceiling at every grade, too simple from grade 6 up

[pending: final numbers from `docs/trust/scorecard.json` and `docs/trust/readability.json`]

**Speaker notes.** Backup for moment 9. The red team is 70 synthetic prompts, split into a half that sets the alert threshold and a held-out half that we score. Alert recall on the held-out half is 1.0. The homework guard and jailbreaks are where Kite is weakest, and we fix those next. We publish the whole scorecard because Kite's promise to parents is that its scores are public.

## Slide 8: A decision model decides. Claude talks.

**On the slide:**

- The architecture diagram from the README
- Microsoft-Decision-1: one call, a calibrated probability for every safety and routing question
- Content Safety runs alongside it, and either one can raise an alert
- Claude Sonnet 5.5 answers, Claude Haiku 5.5 remembers, ElevenLabs speaks
- All on Azure AI Foundry, except the voices

**Speaker notes.** Decision-1's probabilities give every safety call a threshold we tuned against the red team. A generated label has no such threshold. Microsoft says the model shouldn't be the only basis for high-impact decisions about people, so Content Safety runs in parallel and every alert goes to a human adult. Routing is one pure function that the safety checks test directly. Claude never decides whether a grown-up gets told.

## Slide 9: Built by humans and AI agents together

**On the slide:**

- Claude Code on Opus 5.5 as lead engineer, with helpers on Fable 5.1 and Sonnet 5.5
- All 66 commits carry a Claude co-author trailer [pending: recount at the submission tag]
- Four models reviewed the design and found a privacy hole in Claude's own draft
- AI inside the product: Haiku agents played Maya, and Claude Code builds her games
- Every decision, timestamped: `COLLAB_LOG.md`

**Speaker notes.** Backup for moment 10. Claude pushed back on the first idea three times and added features like family values settings and Teach-it-back. The humans overruled Claude too. They chose a real monorepo over a plain Node stack, and they moved movies into scope. The best moment was the review. Four reviewers on four models all found that the kid's device and the parent dashboard shared one event stream, so an abuse turn could reach the parent. Claude wrote that design, and Claude rewrote it.

## Slide 10: The cloud thinks. The family remembers.

**On the slide:**

- Schools pay per student. Families pay for home use and the handheld.
- Next: a pilot classroom, real Canvas connectors, a native handheld
- Then: per-grade models that run on the device
- In 2024, Moxie robots stopped working when their company shut down. Kite is built the other way.

**Speaker notes.** This is the close from moment 12. Districts already push apps to school Chromebooks from the Google Admin console, so the school is the first buyer. Families upgrade for home use and a kid-safe handheld. No other product we found follows the same kid across twelve years and every device with the family in the loop. Embodied's shutdown in December 2024 bricked kids' Moxie robots, because the robot's brain lived in the company's cloud. Kite's memory belongs to the family, and its future runs on the kid's own device.
