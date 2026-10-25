// Play-test one game.html the way the Kite OS iframe will run it: inlined, offline, headless, under
// the brain's policy. Usage: node playtest.mjs [game.html]   Writes dist/game.html and shots/*.png
// next to the source, prints a JSON verdict {passed, errors, out, shots} and exits 1 on failure.
// Error codes, so the agent can fix the right thing: KIT_FORGED, TOO_BIG, GAME_ERROR, NO_READY,
// NO_CANVAS, CANVAS_FROZEN, NOT_FINISHABLE, NETWORK.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const KIT = import.meta.dirname;
const RUN_MS = 5000;
const SOLVE_MS = 30000;
const MAX_BYTES = 2_500_000;
const PAGE = "https://kite.test/game.html";
// The policy the brain serves the game with (brain/kite_brain/routers/games.py): no network at all.
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:";
const src = resolve(process.argv[2] ?? "game.html");
const out = resolve(dirname(src), "dist", "game.html");
const shotsDir = resolve(dirname(src), "shots");
const errors = [];
const shots = [];
const fail = (code, detail) => errors.push(detail ? `${code}: ${String(detail).split("\n")[0].slice(0, 200)}` : code);

function done() {
  const passed = errors.length === 0;
  console.log(JSON.stringify({ passed, errors, out, shots }));
  process.exit(passed ? 0 : 1);
}

// The kit's libraries are the only files a game may reference, and only the ones it references are
// inlined, marked data-kit so the brain skips them when it screens the game's own text. The empty
// KITE_SOUNDS is the slot the brain fills with the kid's UI sounds.
function inline(html) {
  return html.replace(/<script\s+src=["']\.?\/?(kaplay|phaser|gsap|kite-kit)\.js["']\s*>\s*<\/script>/g, (_, name) => {
    const slot = name === "kite-kit" ? '<script data-kit="KITE_SOUNDS">window.KITE_SOUNDS = {};</script>' : "";
    return `${slot}<script data-kit="${name}">${readFileSync(resolve(KIT, `${name}.js`), "utf8")}</script>`;
  });
}

const source = readFileSync(src, "utf8");
if (/data-kit/i.test(source)) {
  fail("KIT_FORGED", "game.html may not use data-kit; load the kit with <script src> tags");
  done();
}
const html = inline(source);
mkdirSync(dirname(out), { recursive: true });
mkdirSync(shotsDir, { recursive: true });
writeFileSync(out, html);
if (Buffer.byteLength(html) > MAX_BYTES) fail("TOO_BIG", `${(Buffer.byteLength(html) / 1e6).toFixed(2)} MB inlined; load one game library, not two`);

setTimeout(() => {
  fail("TIMEOUT");
  done();
}, 90000);

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });

async function open() {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  await page.route("**/*", (route) => {
    if (route.request().url() === PAGE) return route.fulfill({ contentType: "text/html", body: html, headers: { "Content-Security-Policy": CSP } });
    fail("NETWORK", route.request().url());
    return route.abort();
  });
  page.on("pageerror", (e) => fail("GAME_ERROR", e.message));
  page.on("console", (m) => m.type() === "error" && fail("GAME_ERROR", m.text()));
  await page.goto(PAGE, { waitUntil: "load" });
  return page;
}
const said = (page, type) => page.evaluate((t) => (window.__kite ?? []).filter((m) => m.type === t), type);
const shot = async (page, name) => {
  const path = resolve(shotsDir, `${name}.png`);
  await page.screenshot({ path });
  shots.push(path);
};

// Play like a kid: wait for ready, look, tap and press keys, keep playing a while.
const page = await open();
const started = Date.now();
while (!(await said(page, "kite.ready")).length && Date.now() - started < RUN_MS) await page.waitForTimeout(100);
if (!(await said(page, "kite.ready")).length) fail("NO_READY", "kite.ready() was not called within 5 s");
await page.waitForTimeout(1000);
await shot(page, "1-start");
await page.waitForTimeout(Math.max(0, RUN_MS - (Date.now() - started)));

const canvas = page.locator("canvas").first();
if ((await canvas.count()) === 0) {
  fail("NO_CANVAS", "no <canvas> on the page");
} else {
  const before = await canvas.screenshot();
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(600);
  const after = await canvas.screenshot();
  if (before.equals(after)) fail("CANVAS_FROZEN", "canvas pixels did not change after a tap and a key press");
  await shot(page, "2-after-input");
  for (let i = 0; i < 8; i++) {
    await page.mouse.click(box.x + box.width * (0.2 + 0.2 * (i % 4)), box.y + box.height * 0.6);
    await page.keyboard.press(i % 2 ? "ArrowLeft" : "ArrowRight");
    await page.waitForTimeout(700);
  }
  await shot(page, "3-late");
}
await page.close();

// A fresh game, finished by its own kiteTest.solve(): every round must be winnable to the end.
const solver = await open();
await solver.waitForFunction(() => (window.__kite ?? []).some((m) => m.type === "kite.ready"), null, { timeout: RUN_MS }).catch(() => {});
const solveError = await solver.evaluate(async () => {
  if (typeof window.kiteTest?.solve !== "function") return "window.kiteTest.solve() is missing";
  try {
    await window.kiteTest.solve();
  } catch (e) {
    return `solve() threw ${e?.message ?? e}`;
  }
  return null;
});
if (solveError) {
  fail("NOT_FINISHABLE", solveError);
} else {
  const deadline = Date.now() + SOLVE_MS;
  while (!(await said(solver, "kite.finish")).length && Date.now() < deadline) await solver.waitForTimeout(250);
  const [finish] = await said(solver, "kite.finish");
  if (!finish) fail("NOT_FINISHABLE", `kiteTest.solve() did not reach kite.finish() within ${SOLVE_MS / 1000} s`);
  else if (!(finish.total > 0 && finish.correct === finish.total)) fail("NOT_FINISHABLE", `solve() finished with ${finish.correct} of ${finish.total} right; it must get every one right`);
  else {
    await solver.waitForTimeout(1500);
    await shot(solver, "4-end");
  }
}

await browser.close();
done();
