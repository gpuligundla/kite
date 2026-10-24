// Play-test one game.html the way the Kite OS iframe will run it: inlined, offline, headless.
// Usage: node playtest.mjs [game.html]   Writes dist/game.html next to the source, prints a
// JSON verdict {passed, errors, out} and exits 1 on failure. Error codes are named so the
// agent can fix the right thing: GAME_ERROR, NO_READY, NO_CANVAS, CANVAS_FROZEN, NETWORK.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const KIT = import.meta.dirname;
const RUN_MS = 5000;
const src = resolve(process.argv[2] ?? "game.html");
const out = resolve(dirname(src), "dist", "game.html");
const errors = [];
const fail = (code, detail) => errors.push(detail ? `${code}: ${String(detail).split("\n")[0].slice(0, 200)}` : code);

// The kit's two scripts are the only files a game may reference; they become inline, marked
// with data-kit so the brain can skip them when it screens the game's own text.
function inline(html) {
  return html.replace(
    /<script\s+src=["']\.?\/?(kaplay|kite-kit)\.js["']\s*>\s*<\/script>/g,
    (_, name) => `<script data-kit="${name}">${readFileSync(resolve(KIT, `${name}.js`), "utf8")}</script>`,
  );
}

const html = inline(readFileSync(src, "utf8"));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);

const killer = setTimeout(() => {
  console.log(JSON.stringify({ passed: false, errors: [...errors, "TIMEOUT"], out }));
  process.exit(1);
}, 45000);

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
await page.route("**/*", (route) => {
  fail("NETWORK", route.request().url());
  route.abort();
});
page.on("pageerror", (e) => fail("GAME_ERROR", e.message));
page.on("console", (m) => m.type() === "error" && fail("GAME_ERROR", m.text()));

await page.setContent(html, { waitUntil: "load" });
const ready = () => page.evaluate(() => (window.__kite ?? []).some((m) => m.type === "kite.ready"));
const started = Date.now();
while (!(await ready()) && Date.now() - started < RUN_MS) await page.waitForTimeout(100);
if (!(await ready())) fail("NO_READY", "kite.ready() was not called within 5 s");
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
}

await browser.close();
clearTimeout(killer);
const passed = errors.length === 0;
console.log(JSON.stringify({ passed, errors, out }));
process.exit(passed ? 0 : 1);
