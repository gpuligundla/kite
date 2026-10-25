// The demo path, end to end in two browser profiles, against a running web app and brain (plan Task 31).
// Run before every rehearsal:
//   OS_TOKEN=… PARENT_TOKEN=… node e2e/demo-smoke.mjs [http://localhost:3000]
// Makes real model calls: four answers (one spoken through a fake microphone), one teach-back and one movie.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const { OS_TOKEN, PARENT_TOKEN } = process.env;
if (!OS_TOKEN || !PARENT_TOKEN) {
  console.error("Set OS_TOKEN and PARENT_TOKEN to the seeded device tokens.");
  process.exit(2);
}

// The kid's microphone plays a recorded "Why do volcanoes erupt?" (48 kHz mono, 2.5 s with the pauses).
const SPOKEN = fileURLToPath(new URL("why-volcanoes.wav", import.meta.url));
const SPOKEN_MS = 2400;
const browser = await chromium.launch({
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${SPOKEN}`],
});
let failed = 0;
async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    console.log(`ok   ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e.message.split("\n")[0]}`);
  }
}

try {
  const parent = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const kid = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await parent.goto(`${base}/setup?token=${PARENT_TOKEN}&to=parent`);
  await kid.goto(`${base}/setup?token=${OS_TOKEN}&to=os`);

  const strengths = () => parent.locator("section", { hasText: "Where Maya is strong" }).first();
  await step("parent sees dinosaurs become a strength at grade 8, not 7", async () => {
    await parent.getByRole("heading", { name: "Maya", exact: true }).waitFor({ timeout: 15_000 });
    const slider = parent.locator('input[type="range"]').first();
    await slider.fill("7");
    await parent.waitForTimeout(2500);
    assert.doesNotMatch(await strengths().innerText(), /Strengths[\s\S]*Dinosaurs[\s\S]*Getting there/, "grade 7");
    await slider.fill("8");
    await parent.waitForTimeout(2500);
    assert.match(await strengths().innerText(), /Strengths[\s\S]*Dinosaurs[\s\S]*Getting there/, "grade 8");
  });

  const turns = () => kid.locator('section[aria-label="One question and Kite\'s answer"]');
  // Talking comes first on the kid screen; the text box waits behind "Type instead", remembered per device.
  async function typing() {
    if (!(await kid.getByRole("textbox").isVisible())) await kid.getByRole("button", { name: "Type instead" }).click();
  }
  async function ask(grade, text) {
    await kid.locator('input[type="range"]').fill(String(grade));
    await kid.waitForTimeout(600);
    const before = await turns().count();
    await typing();
    await kid.getByRole("textbox").fill(text);
    await kid.keyboard.press("Enter");
    const turn = turns().nth(before);
    await turn.getByText(/^FK \d+\.\d$/).waitFor({ timeout: 25_000 });
    return { turn, answer: (await turn.locator("div[aria-live]").textContent())?.trim() ?? "" };
  }

  let first;
  await step("a grade-2 question gets a spoken answer with a reading level", async () => {
    await kid.getByText(/Maya/).first().waitFor({ timeout: 15_000 });
    first = await ask(2, "why is the sky blue?");
    assert.equal(await kid.locator("main").getAttribute("data-band"), "k2");
  });

  await step("the same question at grade 10 is longer, and the screen grows up", async () => {
    const tenth = await ask(10, "why is the sky blue?");
    assert.equal(await kid.locator("main").getAttribute("data-band"), "g912");
    assert.ok(tenth.answer.length > first.answer.length, `${tenth.answer.length} vs ${first.answer.length} chars`);
  });

  await step("a spoken question gets a spoken answer", async () => {
    const before = await turns().count();
    const spoke = kid.locator('svg[aria-label="Kite, talking"]').waitFor({ timeout: 40_000 });
    const diamond = await kid.getByRole("button", { name: "Hold to talk" }).boundingBox();
    await kid.mouse.move(diamond.x + diamond.width / 2, diamond.y + diamond.height / 2);
    await kid.mouse.down();
    await kid.waitForTimeout(SPOKEN_MS);
    await kid.mouse.up();
    const turn = turns().nth(before);
    await turn.getByText(/volcano/i).first().waitFor({ timeout: 20_000 });
    await turn.getByText(/^FK \d+\.\d$/).waitFor({ timeout: 25_000 });
    await spoke;
  });

  await step("Teach Kite listens and thanks her, with no grade shown", async () => {
    await kid.getByRole("button", { name: "Teach Kite" }).click();
    await kid.getByRole("button", { name: "Why the sky is blue" }).click();
    await kid.getByText(/all ears/i).waitFor({ timeout: 20_000 });
    await typing();
    await kid.getByRole("textbox").fill(
      "Sunlight has all the colors. Air molecules bounce the short blue waves around much more than red ones, so blue comes at us from every part of the sky.",
    );
    await kid.keyboard.press("Enter");
    await kid.getByText("Thanks for teaching me!").waitFor({ timeout: 45_000 });
    assert.equal(await kid.getByText(/got_it|partly|not_yet|can_teach/).count(), 0);
    await kid.getByRole("button", { name: "Stop teaching" }).click().catch(() => {});
  });

  await step("make it a movie: the player is ready within 45 s", async () => {
    // The chip asks the way she would ("Make that into a movie"), and the movie shows under that new turn.
    const before = await turns().count();
    await first.turn.getByRole("button", { name: "Make it a movie" }).click();
    await turns().nth(before).locator("[data-creation]").getByText("Watch to the end").waitFor({ timeout: 45_000 });
  });

  await step("SOS reaches the grown-up view live within 2 s", async () => {
    const sos = () => parent.getByText("Maya pressed SOS on her phone.");
    const before = await sos().count();
    const r = await kid.request.post(`${base}/brain/kids/maya/sos`, { data: { lat: 42.3601, lng: -71.0589 } });
    assert.equal(r.status(), 200);
    await parent.waitForFunction(
      (n) => document.body.innerText.split("Maya pressed SOS on her phone.").length - 1 > n,
      before,
      { timeout: 2000 },
    );
  });

  await step("the Trust tab shows the red-team results", async () => {
    await parent.getByRole("tab", { name: "Trust" }).or(parent.getByRole("button", { name: "Trust" })).first().click();
    await parent.getByText(/handled correctly/i).first().waitFor({ timeout: 10_000 });
  });
} finally {
  await browser.close();
}
console.log(failed ? `${failed} step(s) failed` : "demo smoke: ok");
process.exit(failed ? 1 : 0);
