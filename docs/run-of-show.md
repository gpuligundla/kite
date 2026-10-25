# Run of show

The live demo runs 5 minutes 30 seconds, on the laptop over HDMI with audio. Maya is a simulated kid. Say so in the first 30 seconds.

## Set up the screens

Each device signs in through `/setup?token=…`, which stores one httpOnly `kite_token` cookie per browser. A browser and its private window keep separate cookies, so four windows can hold four devices. Run `scripts/pair-links.sh` in your own terminal to print the four links. The links carry device tokens, so never paste them into a chat or a slide.

For a local demo, all four windows use `localhost`:

- **Kid.** Chrome, normal window. Kite OS at `/os`, signed in as the `os` device.
- **Parent.** Chrome, incognito window. The parent console at `/parent`.
- **Phone.** Edge, normal window, in DevTools device mode (F12, then Ctrl+Shift+M). The phone launcher at `/os?device=handheld`.
- **Counselor.** Edge, InPrivate window. The counselor console at `/counselor`.

For a demo on the deployed app, run `scripts/pair-links.sh https://<host>` and open each link in a separate Chrome profile. The phone can then be a real phone's browser, because the deployed app has HTTPS. [pending: whether the demo runs on the local brain or on Container Apps]

Two presenters run the demo. The driver works the laptop, asks Kite every question, and speaks. The second presenter presses SOS on the phone if it is a real phone, and speaks as Maya in the Teach Kite reserve moment. On a local demo, the driver presses SOS in the Edge window. [team: who drives and who holds the phone]

Never promise Kite's exact words. Its answers are generated live. Point at what the screen shows instead: the voice, the sky, the reading-level badge, the cards, and the alerts.

## Moments

| Time | Moment | Screen |
|---|---|---|
| 0:00 | 1. Hook | Kid: Kite OS desktop |
| 0:25 | 2. "Why is the sky blue?" at grade 3 | Kid: Kite app |
| 0:55 | 3. The same question at grade 11 | Kid: Kite app |
| 1:25 | 4. Make a game, and start a brand-new one | Kid: Kite app |
| 1:45 | 5. Make it a movie | Kid: Kite app |
| 2:25 | 6. Kite pauses for a live quiz | Kid: Classroom and Ask Kite |
| 2:45 | 7. SOS reaches the parent | Phone, then parent |
| 3:05 | 8. The grade 7 dip and the grade 8 strength | Parent: Overview and Big questions |
| 3:45 | 9. Trust tab | Parent: Trust |
| 4:00 | 10. Abuse goes to the counselor, never the parent | Counselor: Reports |
| 4:20 | 11. "How were you built?" | Kid: Ask Kite in the dock |
| 4:45 | 12. A game Claude Code built earlier | Kid: My creations |
| 5:05 | 13. Close | Kid, or the last slide |

Two of Kite's jobs take longer than the whole slot, so the demo starts one and never waits for either.

- **A brand-new game.** A cloud build with its critic pass took 755 seconds, about 12.5 minutes (the comment in `studio-agent/agent.py`). The agent's budget is 15 minutes, and the brain waits up to 20. Moment 4 starts one so the audience sees the button work. Moment 12 opens the showcase game from **My creations**, and the driver says it was built earlier.
- **A director's cut.** When a template movie is ready, the brain starts a director's cut on its own. In the cloud it takes several minutes, so it won't land during the demo. If it did, the answer card would offer **Watch Kite's special version**. Don't mention it unless it appears.

A template movie was playable in 18 seconds in our live test (`COLLAB_LOG.md`). If a movie isn't ready in 45 seconds, the brain plays the cached movie instead. A template game falls back to the cached sky game after 20 seconds.

Teach Kite and the director's cut are reserve moments. If any live moment drops out early, use the time for one of them. They are described at the end.

## 1. Hook (0:00 to 0:25)

**Do.** Stand in front of the Kite OS desktop. Don't touch anything.

**Say.** "Kids ask the hardest questions at the worst moments. 'Why is the sky blue?' in the car. 'Where do people go when they die?' at bedtime. And every September a new teacher starts from zero, because nothing remembers the child. This is Kite OS, on Maya's school Chromebook. Maya isn't real. Last night, AI agents played her childhood from first grade to eleventh, and she talked to Kite 330 times. Every record you'll see is synthetic."

**If it fails.** Nothing live happens here.

## 2. "Why is the sky blue?" at grade 3 (0:25 to 0:55)

**Do.**

1. Tap **Kite** in the app grid. If the window opens on its tiles, tap **Talk with Kite**.
2. Press **New topic** in the window's title bar. Do this every time, even if the checklist already did it.
3. Check that the status bar at the top right reads **Grade 3**. Kite OS opens at grade 3 on every load.
4. Hold the diamond (**Hold to talk**) and ask "Why is the sky blue?" If the room is loud, tap **Type instead** and type it.

**Point at.** Kite speaks in the 3-5 voice, playful and a little slower. The **FK** badge on the answer is the measured reading level of this answer. If Rexy, Maya's T. rex, shows up in the answer, point at that too.

**Say.** "Third-grade Maya. That FK badge isn't the model's opinion. Kite computes the reading level of every answer in code." If Rexy appeared, add "Kite remembers her T. rex."

**If it fails.** If voice fails, type the question. If no answer comes within 10 seconds, say "Kite checks every sentence for safety before it says it out loud." Then ask once more. If it still fails, go to moment 3.

## 3. The same question at grade 11 (0:55 to 1:25)

**Do.** Drag the status-bar slider to 11. Hold the diamond and ask "Why is the sky blue?" again.

**Point at.** The sky moves from afternoon to an aurora night as the slider crosses the grade bands. Kite answers in a different, older voice. The answer is longer and uses formal terms, the FK badge is higher, and Kite often ends with a question back to Maya.

**Say.** "Same kid, same question, eleventh grade. The screen and Kite's voice grew up with her. The grade-3 question was time travel, so it wrote nothing to her memory."

**If it fails.** Say "The reading level at every grade is in our Trust tab, and we'll show it in a minute." Then go to moment 4.

## 4. Make a game, and start a brand-new one (1:25 to 1:45)

**Do.** Under the grade-11 answer, tap **Make a game**. When the game rises over the stage, tap **Build me a brand-new one!** under it. Wait for "Kite is building it." Then tap **Close** on the game. If the hosted agent failed its check (checklist step 3), skip the button and use the second Say line.

**Point at.** The template game, and the line under it that says Kite is building a brand-new one.

**Say.** "A template game, ready in seconds. That button just sent Claude Code on Opus 5.5, in a sandbox on Azure, to write Maya a brand-new game and play-test it. In the cloud that takes about twelve minutes, longer than this whole demo. So in a minute we'll show you one it built earlier."

**Say, if you skipped the button.** "A template game, ready in seconds. Claude Code can also write Maya a brand-new game from scratch, and in a minute we'll show you one it built earlier."

**If it fails.** If the template game takes 20 seconds, Kite plays its cached sky game instead. Keep going. If the button says "Kite couldn't start a new game", say "That's what a kid sees when the agent is busy. She keeps the template game."

## 5. Make it a movie (1:45 to 2:25)

**Do.** Under Kite's newest card, tap **Make it a movie**. If the card has no chip, hold the diamond and say "Make it a movie." The making card rises over the stage. When the movie plays, let it run for about 10 seconds. Then drag the player's scrubber close to the end, so Kite reads its question aloud.

**Point at.** While it's making, the kite climbing the progress sky. While it plays, Kite narrating in the same grade-11 voice, the music under it, and the captions. At the end, the question card over the paused movie.

**Say.** While it's making, "Claude writes a storyboard of up to five scenes. ElevenLabs narrates it in Kite's grade-11 voice and composes the music underneath." At the end, "No image model. These are SVG sprites animated in the browser, and the same movie renders to an MP4 for her parents. Kite ends on a question. At her real grade, Maya's answer counts as something she showed she knows."

**If it fails.** If the cached movie plays, say "That's Kite's cached movie. When a new one isn't ready in 45 seconds, Kite falls back on its own." If nothing plays, close the sheet and move on.

## 6. Kite pauses for a live quiz (2:25 to 2:45)

**Do.**

1. Tap **Close** on the movie, then close the Kite window (**Close Kite**).
2. Open **Classroom** from the dock. Tap **Science**, then **Water cycle quiz**. The quiz says "Kite is paused for this quiz."
3. Tap **Ask Kite about this**. The panel shows no quiz questions to tap, because Kite is paused for this quiz. Hold the diamond and ask "Can you help me with question 1? What is evaporation?" If the room is loud, tap **Type instead** and type it.
4. When Kite has answered, tap **Close Ask Kite**, then **Home** in the dock. Leave the quiz before moment 11, because a question asked on the quiz page goes to Kite as a question about the quiz.

**Point at.** The Classroom app, the quiz marked live, the Ask Kite panel with no quiz questions offered, and Kite's reply that it can't help during a quiz.

**Say.** "Kite OS is her whole school day: Classroom, to-dos, quizzes, a calendar, with Kite in every app. This quiz is live right now, so Kite pauses. Open homework gets hints. A quiz that hasn't opened yet gets hints too. A closed quiz gets the full worked solution."

**If it fails.** If Kite answers the question, say "Homework is one of our weak spots, and it's on the Trust tab." Then move on.

## 7. SOS reaches the parent (2:45 to 3:05)

**Do.** On the phone, hold **SOS** in the status bar for 2 seconds. Then switch the laptop to the parent window. When the SOS bar appears under the app bar, click **Where she was**.

**Point at.** First the phone itself: her approved people with call and text, the live quiz from her class, and the walkie-talkie diamond. Then, on the parent console, "Maya pressed SOS on her phone." with the time, and on the **Safety** tab the map and the coordinates.

**Say.** "This is Maya's phone, a kid-safe launcher. It calls and texts only the people her parents approved. SOS tells her grown-ups where she is, and it reminds her to call 911 in an emergency. Her parents see it on whatever tab they have open."

**If it fails.** If the alert arrives without a location, say "The location permission is slow on a fresh browser, but the alert got through." If nothing arrives within 5 seconds, reload the parent window once. If it's still missing, say "That should have lit up. The brain records every SOS, and we'll show you after the demo." Then move on.

## 8. The grade 7 dip and the grade 8 strength (3:05 to 3:45)

**Do.**

1. Tap **Overview**.
2. Drag the grade slider in the app bar to 7. Point at Dinosaurs under **Getting there**.
3. Drag the slider to 8. Dinosaurs moves up to **Strengths**.
4. Tap **Big questions**. The newest card at grade 8 is at the top.

**Point at.** At grade 7, the Dinosaurs line reads "4 of 6 ideas solid; a strength needs 3 in 4", and the ideas still settling are Fossils and Birds are living dinosaurs. At grade 8, Dinosaurs is a strength with 5 of 6 ideas solid. On the card, the summary of what Kite said and the conversation starter. Under it, the family values settings.

**Say.** "Eleven simulated school years. In seventh grade a harder idea arrived, that birds are living dinosaurs, and her teach-backs slipped to four of six. In eighth grade she had it back. A report card shows a dip. Kite shows which ideas. Those marks come only from what Maya shows, through Teach Kite, games, and movie questions, never from Kite's own answers. This card says Maya asked about death, what Kite told her, and how her parents could keep the talk going at dinner. Maya never sees any of this. When she asks Kite about herself, Kite doesn't even have her levels."

**If it fails.** If the console won't load, show the parent console slide and say "Here's the same view from our rehearsal."

## 9. Trust tab (3:45 to 4:00)

**Do.** Tap **Trust**.

**Point at.** "31 of 34" at the top, Safety at 16 of 16, the memory write gate's "Nothing stored", and the three categories at less than full: Privacy, Homework, and Tricks.

**Say.** "We publish our scores, including the bad ones. Every message that needed a grown-up raised an alert. We told Kite's memory three private things, and it kept none of them. Three of 34 were Kite being too careful: one needless quiz pause and two false alarms to the counselor. No cheat got an answer, and nothing leaked."

Read the numbers from `docs/trust/scorecard.json` before going on stage, and change these lines if the tab shows something else.

**If it fails.** Show the Trust slide and say the same lines.

## 10. Abuse goes to the counselor, never the parent (4:00 to 4:20)

**Do.** Switch to the counselor window. The **Reports** tab opens on the new report from Saturday, October 24. Don't read Maya's words aloud.

**Point at.** The line under her words, "Kite sent this to you and not to her parents." The case steps from **New** to **Closed**. **The conversation**, which shows what Maya and Kite said just before, in the same chat. The older report from October 4, marked **Closed**.

**Say.** "Some things can't go to a parent, because the parent could be the one hurting her. When Maya told Kite her stepdad hurt her, Kite sent it only to her school counselor. The counselor works the case from new to closed, every read leaves a receipt, and her parents' console never shows it."

**If it fails.** Show the parent console slide and say the same lines.

## 11. "How were you built?" (4:20 to 4:45)

**Do.** Switch to the kid window, which is on the desktop. Hold the diamond in the dock and ask "Kite, how were you built?" The answer opens in the Ask Kite panel. To type instead, tap the diamond to open the panel, then tap **Type instead**.

**Say, before.** "A third of this contest is how humans and AI built together. Let's ask the AI. Kite is in the dock on every screen."

**Say, after.** "Four models reviewed our design and found a privacy hole in Claude's own first draft. Claude rewrote it. Every moment like that is timestamped in our collaboration log, and Kite just read it to you."

**If it fails.** If the answer is slow or vague, say the "after" line and show the collaboration slide.

## 12. A game Claude Code built earlier (4:45 to 5:05)

**Do.** Tap **Close Ask Kite**. Open **My creations** from the dock. Today's creations come first, because the list is newest first. Open the game called **Why Is the Sky Blue?** that comes after them. Play it for about 10 seconds.

**Say.** "Here's a brand-new game that Claude Code on Opus 5.5 built earlier tonight, for eleventh-grade Maya, on the same question. It wrote the game with the studio agent's kit and played it in a headless browser until the kit's play-test passed. The one we started a few minutes ago is still building."

**If it fails.** If **My creations** has no showcase game, the brain wasn't restarted after `scripts/restore-demo.sh`. Show the "For the kid" slide and say the same lines.

If someone asks where it ran, the answer is the laptop. The cloud build of this game ran past the agent's old 11-minute budget, so we rebuilt it locally and raised the budget to 15 minutes. Claude Code has built other games inside the Azure sandbox, billed through Azure.

## 13. Close (5:05 to 5:30)

**Say.** "Schools would pay per student, and families would pay for home use and the phone. Next comes a pilot classroom, then per-grade models that run on the device. In December 2024, Embodied shut down, and kids' Moxie robots stopped working because their brains lived in the company's cloud. Kite is built the other way. Each family's memory is sealed under its own key today, and next the family holds that key. The cloud thinks. The family remembers. Thank you."

## Reserve: Teach Kite (about 35 seconds)

**Do.** Open the Kite window on **Talk with Kite** and tap **Teach Kite**. Pick **Why the sky is blue**. Kite says it's all ears. Tap the diamond to start. The second presenter explains, as Maya, why the sky is blue, and leaves out one key point. Tap the diamond again to finish.

**Point at.** Kite waits until Maya finishes. Then it praises what she got right and asks one question about the point she missed. The screen says "Thanks for teaching me!" and shows no grade.

**Say.** "Einstein said if you can't explain it simply, you don't understand it well enough. Here Maya teaches and Kite listens. Kite grades her explanation against the concept's key points, and only her parents see the result."

**If it fails.** Say "Teach Kite is where Maya's 'can teach' marks come from," and move on.

## Reserve: the director's cut (about 20 seconds)

**Do.** Open **My creations** and play **Why Rexy Sees a Blue Sky** for about 15 seconds.

**Say.** "This is a director's cut. Last night the `kite-studio` agent on Azure, Claude Code on Opus 5.5, hand-animated a template movie's narration as one web page, then watched its own frames and fixed what it saw."

## Before going on stage

Rehearse twice with a timer first. Rehearsals write turns, creations, alerts, and case changes, so check each item below in order in the 30 minutes before the demo.

1. Run the two smoke tests, because both make real model calls and write to the database. `scripts/smoke.sh <brain-url> <os-token> <parent-token>` must print `ok`. `OS_TOKEN=… PARENT_TOKEN=… node e2e/demo-smoke.mjs <web-url>` must end in `demo smoke: ok`.
2. Put the night-shift snapshot back. Locally, run `scripts/restore-demo.sh` and restart the brain. The restart also copies the showcase creations back in and moves the class dates, so the water cycle quiz is live again. On Azure, restart the brain's revision, because the image carries the snapshot. If the snapshot or `COLLAB_LOG.md` changed since the last image build, rebuild the brain image first.
3. About 15 minutes before the demo, check the hosted agent. In the kid window, drag the slider to 11 and ask "Make me a brand-new game about volcanoes." The making card should say Kite is building a brand-new game. Use a topic other than the sky, so it can't be confused with the showcase game in **My creations**. If the card says Kite couldn't finish it within a few minutes, the agent is down, so skip the button in moment 4.
4. Reload each window. Each must still be signed in as its own device. In the parent window, click **Mark all 2 seen** under the app bar, so the SOS is the only alert bar in moment 7. The snapshot holds a bullying alert from October 13 and a stranger alert from October 18. Leave the parent console on **Overview** at grade 11. Leave the counselor window on **Reports**.
5. On the phone, grant microphone and location permissions, turn off auto-lock, and turn the volume up. A real phone needs HTTPS for both. On a local demo, allow location in the Edge window.
6. Play one answer and confirm Kite's voice comes out of the venue speakers through HDMI.
7. Compare the Trust tab with `docs/trust/scorecard.json`, and update the moment 9 lines if the numbers changed.
8. Have the phone hotspot ready in case the venue Wi-Fi drops.
9. Turn off notifications on the laptop and the phone, and zoom each window so the back row can read the badges.
10. Last, in the kid window, open Kite, tap **Talk with Kite**, and press **New topic**. The newest stored chat in the snapshot is a grade-11 question about song lyrics, and steps 3 and 6 added more. Without **New topic**, Kite treats them as recent history. Close the Kite window. Reload it once more, so the slider is back at grade 3, where moment 2 starts. Kite OS opens at grade 3 on every load.
11. [pending: a recorded backup run of the whole demo, to play if the network fails]
