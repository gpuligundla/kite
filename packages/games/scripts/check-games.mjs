// Run: npm -w packages/games run check
// Builds each template into a scratch page and plays it in headless Chromium.
// Screenshots go to $KITE_SHOTS (default: packages/games/shots).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = process.env.KITE_SHOTS ?? path.join(here, "../shots");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "kite-games-"));
fs.mkdirSync(shots, { recursive: true });

fs.writeFileSync(
  path.join(out, "entry.ts"),
  `import { mountGame, sortLayout } from ${JSON.stringify(path.join(here, "../src/index.ts"))};
   window.kite = { mountGame, sortLayout };`,
);
await build({ entryPoints: [path.join(out, "entry.ts")], bundle: true, outfile: path.join(out, "bundle.js"), format: "iife", logLevel: "error" });
fs.writeFileSync(
  path.join(out, "index.html"),
  `<!doctype html><body style="margin:0"><canvas id="c" width="960" height="600"></canvas><script src="bundle.js"></script>`,
);

const item = (label, sprite, rest) => ({ label, sprite, correct: null, bin: null, ...rest });
const specs = {
  catch: {
    template: "catch", title: "Catch the blue light", instructions: "Catch the blue things. Skip the red ones!", concept_id: "light", bins: [],
    items: [item("blue", "drop", { correct: true }), item("sky", "circle", { correct: true }), item("red", "heart", { correct: false }), item("fire", "star", { correct: false })],
  },
  sort: {
    template: "sort", title: "Area or perimeter", instructions: "Drag each card into the right bin.", concept_id: "area_perimeter", bins: ["Area", "Perimeter"],
    items: [item("inside", "square", { bin: "Area" }), item("fence", "triangle", { bin: "Perimeter" }), item("carpet", "circle", { bin: "Area" }), item("border", "star", { bin: "Perimeter" })],
  },
};

const browser = await chromium.launch();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(spec) {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`file://${path.join(out, "index.html")}`);
  await page.evaluate((s) => {
    window.finished = [];
    window.stop = window.kite.mountGame(document.getElementById("c"), s, (r) => window.finished.push(r));
  }, spec);
  await sleep(1000);
  const box = await page.locator("#c").boundingBox();
  const at = (x, y) => [box.x + (x * box.width) / 960, box.y + (y * box.height) / 600];
  return { page, errors, box, at };
}

const snap = (page, clip) => page.screenshot({ clip });

// ---- catch
{
  const { page, errors, box, at } = await open(specs.catch);
  await page.screenshot({ path: path.join(shots, "catch-start.png") });
  await page.mouse.click(...at(480, 460));
  await sleep(300);
  const strip = { x: box.x, y: box.y + 520, width: box.width, height: 80 };
  const before = await snap(page, strip);
  await page.keyboard.down("ArrowRight");
  await sleep(500);
  await page.keyboard.up("ArrowRight");
  const after = await snap(page, strip);
  assert.notDeepEqual(before, after, "catch: arrow keys did not move the catcher");

  const pointerBefore = await snap(page, strip);
  await page.mouse.move(...at(120, 300));
  await sleep(100);
  assert.notDeepEqual(pointerBefore, await snap(page, strip), "catch: pointer did not move the catcher");

  await sleep(4000);
  await page.screenshot({ path: path.join(shots, "catch-play.png") });
  assert.deepEqual(errors, [], "catch: console errors in the first 5 s");
  assert.equal(await page.evaluate(() => window.finished.length), 0, "catch: finished too early");

  for (let i = 0; i < 40 && (await page.evaluate(() => window.finished.length)) === 0; i++) await sleep(1000);
  await sleep(500);
  const finished = await page.evaluate(() => window.finished);
  assert.equal(finished.length, 1, "catch: onFinish must be called exactly once");
  assert.ok(finished[0].total >= 1 && finished[0].correct <= finished[0].total, "catch: bad result " + JSON.stringify(finished));
  await page.screenshot({ path: path.join(shots, "catch-end.png") });
  assert.deepEqual(errors, [], "catch: console errors");
  await page.evaluate(() => window.stop());
  console.log("catch ok:", JSON.stringify(finished[0]));
  await page.close();
}

// ---- sort
{
  const spec = specs.sort;
  const { page, errors, at } = await open(spec);
  await page.screenshot({ path: path.join(shots, "sort-start.png") });
  await page.mouse.click(...at(480, 460));
  await sleep(500);
  const layout = await page.evaluate((s) => window.kite.sortLayout(s), spec);

  const drag = async (from, to) => {
    await page.mouse.move(...at(from.x, from.y));
    await page.mouse.down();
    await page.mouse.move(...at((from.x + to.x) / 2, (from.y + to.y) / 2), { steps: 5 });
    await page.mouse.move(...at(to.x, to.y), { steps: 5 });
    await page.mouse.up();
    await sleep(100);
  };
  const binFor = (i) => layout.bins[spec.bins.indexOf(spec.items[i].bin)];
  const wrongBin = (i) => layout.bins[1 - spec.bins.indexOf(spec.items[i].bin)];

  const before = await page.screenshot();
  await drag(layout.items[0], wrongBin(0)); // first try wrong: it returns home and loses the point
  await drag(layout.items[0], binFor(0));
  assert.notDeepEqual(before, await page.screenshot(), "sort: dragging did not change the canvas");
  await sleep(4000);
  await page.screenshot({ path: path.join(shots, "sort-play.png") });
  assert.deepEqual(errors, [], "sort: console errors in the first 5 s");
  assert.equal(await page.evaluate(() => window.finished.length), 0, "sort: finished too early");

  for (let i = 1; i < spec.items.length; i++) await drag(layout.items[i], binFor(i));
  await sleep(1500);
  const finished = await page.evaluate(() => window.finished);
  assert.equal(finished.length, 1, "sort: onFinish must be called exactly once");
  assert.deepEqual(finished[0], { correct: 3, total: 4 }, "sort: one wrong first drop should leave 3 of 4");
  await page.screenshot({ path: path.join(shots, "sort-end.png") });
  assert.deepEqual(errors, [], "sort: console errors");
  await page.evaluate(() => window.stop());
  console.log("sort ok:", JSON.stringify(finished[0]));
  await page.close();
}

await browser.close();
fs.rmSync(out, { recursive: true, force: true });
console.log("screenshots in", shots);
