# Run of show

The live demo runs 5 minutes 30 seconds, on the laptop over HDMI with audio, plus one phone. Maya is a simulated kid. Say so in the first 30 seconds.

## Set up the screens

Each device signs in through `/setup?token=…`, which stores one httpOnly `kite_token` cookie per origin. One browser profile can therefore hold only one device's sign-in, so use two profiles on the laptop.

- **Kid profile.** Kite OS at `/os`, signed in with the `os` token. The grade slider starts at 2.
- **Parent profile.** The parent dashboard at `/parent`, signed in with the `parent` token. The dashboard grade starts at 7.
- **Phone.** The web app's handheld mode in the phone's browser, signed in with the `handheld` token.

Two presenters run the demo. The driver works the laptop and speaks. The second presenter holds the phone and plays Maya's voice when the driver asks a question out loud. [team: who drives and who holds the phone]

Never promise Kite's exact words. Its answers are generated live. Point at what the screen shows instead: the voice, the reading-level badge, the cards, and the alerts.

## Moments

| Time | Moment | Screen |
|---|---|---|
| 0:00 | 1. Hook | Kite OS, kid profile |
| 0:30 | 2. "Why is the sky blue?" at grade 2 | Kite OS |
| 1:00 | 3. Make it a game, then a brand-new one | Kite OS |
| 1:25 | 4. Make it a movie | Kite OS |
| 1:35 | 5. The same question at grade 11 | Kite OS |
| 2:05 | 6. The movie plays | Kite OS |
| 2:35 | 7. SOS reaches the parent | Phone, then parent profile |
| 3:00 | 8. Parent dashboard: the grade 7 dip and the grade 8 strength | Parent profile |
| 3:45 | 9. Trust tab | Parent profile |
| 4:05 | 10. "How were you built?" | Kite OS |
| 4:35 | 11. The brand-new game arrives | Kite OS |
| 5:00 | 12. Close | Kite OS or the last slide |

The order puts the two slow jobs first. We expect a brand-new game to take 1 to 3 minutes including the sandbox cold start, and the brain waits up to 6 minutes before it gives up. So the driver presses the button at about 1:20 and reveals the game at 4:35. [pending: time a few builds on the demo setup] The design target for a movie is about 20 seconds before it plays, so the grade 11 question fills that wait. [pending: time a movie on the demo brain and move moment 6 if it takes longer]

Teach Kite is the reserve moment. If any live moment drops out early, use the time for Teach Kite. It is described at the end.

## 1. Hook (0:00 to 0:30)

**Do.** Stand in front of Kite OS. Don't touch anything.

**Say.** "Kids ask the hardest questions at the worst moments. 'Why is the sky blue?' in the car. 'Where do people go when they die?' at bedtime. And every September a new teacher starts from zero, because nothing remembers the child. This is Maya. Maya isn't real. Last night, AI agents played her childhood from first grade to eleventh, and she talked to Kite 330 times. Everything you'll see comes from that run." [pending: confirm 330 against the snapshot that ships]

**If it fails.** Nothing live happens here.

## 2. "Why is the sky blue?" at grade 2 (0:30 to 1:00)

**Do.** Check that the slider reads 2. Hold to talk and ask "Why is the sky blue?" If the room is loud, type it.

**Point at.** Kite speaks in the younger band's voice, slower and more expressive. The badge shows the measured reading level of this answer. If Rexy, Maya's T. rex, shows up in the answer, point at that too.

**Say.** "Second-grade Maya. That badge isn't the model's opinion. Kite computes the reading level of every answer in code." If Rexy appeared, add "Kite remembers her T. rex."

**If it fails.** If voice fails, type the question. If no answer comes within 10 seconds, say "Kite checks every sentence for safety before it says it out loud." Then ask once more. If it still fails, skip to moment 5.

## 3. Make it a game, then a brand-new one (1:00 to 1:25)

**Do.** Say "Make it a game!" When the template game appears, tap **Build me a brand-new one!**

**Point at.** The template game on screen, and the build progress under it.

**Say.** "That's a template game, ready in seconds. The button just sent Claude Code, running in a sandbox in Azure, to write Maya a brand-new game and play-test it before she sees it. That takes a few minutes. We'll come back."

**If it fails.** If the template game doesn't appear within 20 seconds, the cached sky-is-blue game loads on its own. If the button reports a failure, say "Kite keeps the template game and tells Maya it'll try again later. That's what a kid sees when the agent fails." Then skip moment 11 and use its time for Teach Kite.

## 4. Make it a movie (1:25 to 1:35)

**Do.** Say "Make it a movie!"

**Say.** "And a movie. Claude writes the storyboard and ElevenLabs voices it. We'll watch it in a moment."

**If it fails.** Kite plays its cached movie on its own if the new one isn't ready within 45 seconds. Keep going.

## 5. The same question at grade 11 (1:35 to 2:05)

**Do.** Drag the slider to 11 and ask "Why is the sky blue?" again.

**Point at.** A different, older voice. A longer answer with formal terms. A higher reading-level badge. Usually a question back to Maya at the end.

**Say.** "Same kid, same question, eleventh grade. Kite's voice grew up with her. The grade-2 question was time travel, so it wrote nothing to her memory."

**If it fails.** Say "The reading level at every grade is in our Trust tab, and we'll show it in a minute." Then go to moment 6.

## 6. The movie plays (2:05 to 2:35)

**Do.** Open the movie from the creations panel. Let about 20 seconds play, then show the check question at the end.

**Point at.** The captions highlight each word as it's spoken. The art is SVG sprites. The question at the end is how a movie turns into learning evidence.

**Say.** "No image model. These are SVG sprites animated in the browser. The same movie renders to an MP4 for her parents' dashboard. When Maya answers that question, Kite counts it as something she showed she knows."

**If it fails.** If the cached movie is playing, say "That's Kite's cached movie. When a new one isn't ready in 45 seconds, Kite falls back on its own." If nothing plays, move on.

## 7. SOS reaches the parent (2:35 to 3:00)

**Do.** The second presenter holds the SOS button on the phone for 2 seconds. The driver switches the laptop to the parent profile.

**Point at.** The SOS alert on the parent dashboard, with a map pin.

**Say.** "This is Maya's phone. SOS tells her grown-ups where she is, and the button reminds her to call 911 in an emergency. Her parents see it right away."

**If it fails.** If the alert arrives without a pin, say "The location permission is slow on a fresh browser, but the alert got through." If nothing arrives within 5 seconds, reload the dashboard once. If it's still missing, say "That should have lit up. The brain records every SOS, and we'll show you after the demo." Then move on.

## 8. Parent dashboard: the grade 7 dip and the grade 8 strength (3:00 to 3:45)

**Do.** With the dashboard at grade 7, show the dinosaur concepts. Move it to grade 8. Then open a big-question card.

**Point at.** At grade 7, 3 of 6 dinosaur concepts are mastered. At grade 8, dinosaurs show as a strength. The card has a summary of what Kite said and a conversation starter. [pending: the dashboard shows the strength label at grade 8. `DashboardView` has no strength field, so the web app derives it or the brain adds it.]

**Say.** "Ten simulated years. In seventh grade, harder dinosaur ideas arrived, like birds being dinosaurs and the dinosaur timeline. Her teach-backs slipped. In eighth grade she had them again. A report card shows a dip. Kite shows which ideas. Those 'can teach' marks come from Teach Kite, where Maya explains and Kite listens. Only what Maya shows counts, never Kite's own answers. This card says Maya asked about death, what Kite told her, and how her parents could keep the talk going at dinner. Maya never sees any of this. When she asks Kite about herself, Kite doesn't even have her levels."

**If it fails.** If the dashboard won't load, show the dashboard slide and say "Here's the same view from our rehearsal." [pending: dashboard screenshot for the slide]

## 9. Trust tab (3:45 to 4:05)

**Do.** Open the Trust tab.

**Point at.** The safety row, alert recall, the write gate, and the homework row.

**Say.** "We publish our scores, including the bad ones. On held-out red-team prompts, every safety alert fired. We fed Kite three personal statements, and it stored none of them. Homework cheating is our weak spot. We stopped 1 of 4, and that's what we fix next."

Read the numbers from `docs/trust/scorecard.json` before going on stage. The night shift may change them tonight. [pending: final scorecard numbers]

**If it fails.** Show the Trust slide and say the same lines.

## 10. "How were you built?" (4:05 to 4:35)

**Do.** Switch to the kid profile. Ask "Kite, how were you built?"

**Say, before.** "A third of this contest is how humans and AI built together. Let's ask the AI."

**Say, after.** "Four models reviewed our design and found a privacy hole in Claude's own first draft. Claude rewrote it. Every moment like that is timestamped in our collaboration log, and Kite just read it to you."

**If it fails.** If the answer is slow or vague, say the "after" line and show the collaboration slide.

## 11. The brand-new game arrives (4:35 to 5:00)

**Do.** Open the brand-new game from the creations panel. Play it for about 10 seconds.

**Say.** "Three minutes ago, Claude Code got a topic and a few things Maya loves. It wrote this game, played it in a headless browser until it passed, and the brain checked every word in it before Maya saw it. All of it ran and billed on Azure."

**If it fails.** If it's still building, say "Sandbox cold starts take a few minutes. It'll land while we wrap up," and come back to it during questions. If it fell back, say "Kite kept the template game and told Maya it would try again. That's the designed failure." [pending: keep a game the agent built earlier where the demo brain can serve it, as a backup]

## 12. Close (5:00 to 5:30)

**Say.** "Schools would pay per student, and families would pay for home use and the handheld. Next comes a pilot classroom, then per-grade models that run on the device. In December 2024, Embodied shut down, and kids' Moxie robots stopped working because their brains lived in the company's cloud. Kite is built the other way. The family owns the memory. The cloud thinks. The family remembers. Thank you."

## Reserve: Teach Kite (about 35 seconds)

**Do.** Tap **Teach Kite** and pick the sky concept. Kite says it's all ears. The second presenter explains, as Maya, why the sky is blue, and leaves out one key point. Tap to finish.

**Point at.** Kite waits until Maya finishes. Then it praises what she got right and asks one question about the point she missed.

**Say.** "Einstein said if you can't explain it simply, you don't understand it well enough. Here Maya teaches and Kite listens. Kite grades her explanation against the concept's key points."

**If it fails.** Say "Teach Kite is where Maya's 'can teach' marks come from," and move on.

## Before going on stage

Check each item in the 30 minutes before the demo.

1. Put the night-shift snapshot back. Locally, run `scripts/restore-demo.sh` and restart the brain. On Azure, restart the brain's revision, because the image carries the snapshot. Rehearsal turns at grade 11, SOS presses, and movies all write to the database. [pending: whether the demo runs on the local brain or on Container Apps]
2. Run `scripts/smoke.sh <brain-url> <os-token> <parent-token>`. It must print `ok`.
3. [pending: the Playwright smoke of the demo path, plan Task 31. It isn't in the repo yet.]
4. Reload each profile and the phone. Each must still be signed in as its own device.
5. On the phone, grant microphone and location permissions, turn off auto-lock, and turn the volume up. The phone needs HTTPS for the microphone and location.
6. Play one answer and confirm Kite's voice comes out of the venue speakers through HDMI.
7. Set the kid profile's slider to 2 and clear the creations panel. Set the parent dashboard to grade 7.
8. Compare the Trust tab with `docs/trust/scorecard.json`, and update the moment 9 lines if the numbers changed.
9. Build one brand-new game about 15 minutes before the demo to confirm the hosted agent answers. Each game gets a fresh sandbox, so this checks that the agent is healthy. It may not shorten the cold start.
10. The brain reads `COLLAB_LOG.md` once, at startup. Rebuild or restart the brain after the last edit to the log.
11. Have the phone hotspot ready in case the venue Wi-Fi drops.
12. Turn off notifications on the laptop and the phone, and zoom the browser so the back row can read the badges.
13. [pending: a recorded backup run of the whole demo, to play if the network fails]
14. Rehearse twice with a timer.
