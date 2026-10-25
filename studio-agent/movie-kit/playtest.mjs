// Play-test one movie.html the way the Kite OS iframe will run it: inlined, offline, headless, 1280x720.
// Usage: node playtest.mjs [movie.html]   Writes dist/movie.html and shots/*.png next to the source,
// prints a JSON verdict {passed, errors, out, shots, duration, narration} and exits 1 on failure.
// Error codes, so the agent can fix the right thing: KIT_FORGED, MOVIE_ERROR, NO_READY, BAD_DURATION,
// SAME_FRAMES, SEEK_UNSTABLE, NO_GUIDE, TEXT_COVERED, TEXT_CLIPPED, NO_PLAY, NETWORK.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const KIT = import.meta.dirname;
const AT = [0.1, 0.35, 0.6, 0.9];
const PAGE = "https://kite.test/movie.html";
// The policy the brain serves the movie with (brain/kite_brain/routers/games.py): no network at all.
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:";
const src = resolve(process.argv[2] ?? "movie.html");
const here = dirname(src);
const out = resolve(here, "dist", "movie.html");
const shotsDir = resolve(here, "shots");
const errors = [];
const shots = [];
const fail = (code, detail) => errors.push(detail ? `${code}: ${String(detail).split("\n")[0].slice(0, 200)}` : code);
let info = {};

function done() {
  const passed = errors.length === 0;
  console.log(JSON.stringify({ passed, errors, out, shots, duration: info.duration, narration: info.narration }));
  process.exit(passed ? 0 : 1);
}

// The kit's scripts and the movie's data are the only files a movie may reference. They become
// inline, marked data-kit so the brain skips them when it screens the movie's own text. The empty
// KITE_AUDIO is the slot the brain fills with the real narration.
function inline(html) {
  return html.replace(/<script\s+src=["']\.?\/?(gsap|movie-data|kite-movie)\.js["']\s*>\s*<\/script>/g, (_, name) => {
    const code = readFileSync(resolve(name === "movie-data" ? here : KIT, `${name}.js`), "utf8");
    const slot = name === "kite-movie" ? '<script data-kit="KITE_AUDIO">window.KITE_AUDIO = {};</script>' : "";
    return `${slot}<script data-kit="${name}">${code}</script>`;
  });
}

// A silent 8 kHz WAV, so play() has narration of the right length without the real voices.
function silence(seconds) {
  const n = Math.max(1, Math.round(seconds * 8000));
  const wav = Buffer.alloc(44 + n, 128);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + n, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(8000, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(n, 40);
  return `data:audio/wav;base64,${wav.toString("base64")}`;
}

const source = readFileSync(src, "utf8");
if (/data-kit/i.test(source)) {
  fail("KIT_FORGED", "movie.html may not use data-kit; load the kit with the three <script src> tags");
  done();
}
const html = inline(source);
mkdirSync(dirname(out), { recursive: true });
mkdirSync(shotsDir, { recursive: true });
writeFileSync(out, html);

setTimeout(() => {
  fail("TIMEOUT");
  done();
}, 90000);

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
async function open() {
  const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await p.route("**/*", (route) => {
    if (route.request().url() === PAGE) return route.fulfill({ contentType: "text/html", body: html, headers: { "Content-Security-Policy": CSP } });
    fail("NETWORK", route.request().url());
    return route.abort();
  });
  p.on("pageerror", (e) => fail("MOVIE_ERROR", e.message));
  p.on("console", (m) => m.type() === "error" && fail("MOVIE_ERROR", m.text()));
  await p.goto(PAGE, { waitUntil: "load" });
  return p;
}
let page = await open();
const ready = () => page.evaluate(() => (window.__kite ?? []).some((m) => m.type === "kite.ready"));
const started = Date.now();
while (!(await ready()) && Date.now() - started < 5000) await page.waitForTimeout(100);
if (!(await ready())) {
  fail("NO_READY", "kite.ready() was not called within 5 s");
  await browser.close();
  done();
}

info = await page.evaluate(() => window.kite.info());
if (!(Math.abs(info.duration - info.narration) <= 0.1 * info.narration)) {
  fail("BAD_DURATION", `kite.timeline runs ${info.duration?.toFixed(1)} s but the narration runs ${info.narration.toFixed(1)} s; stay within 10%`);
}

const hidePlay = { content: "#kite-play{display:none!important}" };
await page.addStyleTag(hidePlay);
const frame = async (seconds) => {
  await page.evaluate((s) => window.kite.seek(s), seconds);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page.screenshot();
};
// Visible text that the guide (#guide) is drawn over, and visible text cut off by the stage's edge.
// Geometry picks the candidates; pixels confirm them: the box changes when the guide, or the cut-off
// text itself, is hidden.
const showsIn = async (selector, clip) => {
  const before = await page.screenshot({ clip });
  const was = await page.evaluate((s) => {
    const style = document.querySelector(s).style;
    const old = style.visibility;
    style.visibility = "hidden";
    return old;
  }, selector);
  const after = await page.screenshot({ clip });
  await page.evaluate(([s, old]) => (document.querySelector(s).style.visibility = old), [selector, was]);
  return !before.equals(after);
};
const textProblems = async () => {
  const found = await hitTest();
  if (found === null) return null;
  const out = [];
  for (const { text, clip } of found.covered) if (await showsIn("#guide", clip)) out.push(["TEXT_COVERED", text, "the guide stands on"]);
  for (const { text, clip, probe } of found.clipped) {
    if (await showsIn(`[data-kite-probe="${probe}"]`, clip)) out.push(["TEXT_CLIPPED", text, "the stage edge cuts off"]);
  }
  return out;
};
const hitTest = () => page.evaluate(() => {
  const guide = document.getElementById("guide");
  if (!guide) return null;
  const shown = (el) => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.display === "none" || s.visibility === "hidden" || +s.opacity < 0.05) return false;
    }
    return true;
  };
  const owns = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const texts = [...document.querySelectorAll("#stage *")].filter((el) => !guide.contains(el) && owns(el) && shown(el));
  const label = (el) => el.textContent.trim().slice(0, 40);
  const stage = document.getElementById("stage").getBoundingClientRect();
  document.querySelectorAll("[data-kite-probe]").forEach((el) => el.removeAttribute("data-kite-probe"));
  const clipped = texts.flatMap((el, probe) => {
    const r = el.getBoundingClientRect();
    const past = r.left < stage.left - 2 || r.top < stage.top - 2 || r.right > stage.right + 2 || r.bottom > stage.bottom + 2;
    const left = Math.max(r.left, stage.left), right = Math.min(r.right, stage.right);
    const top = Math.max(r.top, stage.top), bottom = Math.min(r.bottom, stage.bottom);
    if (!past || right - left < 2 || bottom - top < 2) return [];
    el.setAttribute("data-kite-probe", probe);
    return [{ text: label(el), probe, clip: { x: left, y: top, width: right - left, height: bottom - top } }];
  });
  const under = texts.map((el) => {
    const r = el.getBoundingClientRect();
    const points = [];
    for (let i = 1; i <= 10; i++) {
      for (let j = 1; j <= 3; j++) points.push([r.left + (r.width * i) / 11, r.top + (r.height * j) / 4]);
    }
    return [el, points.filter(([x, y]) => guide.contains(document.elementFromPoint(x, y)))];
  });
  // Only where the text itself would show with the guide gone, so text behind a scenery layer doesn't count.
  const was = guide.style.visibility;
  guide.style.visibility = "hidden";
  const hidden = under.filter(([el, points]) => points.filter(([x, y]) => el.contains(document.elementFromPoint(x, y))).length >= 2);
  guide.style.visibility = was;
  return {
    clipped,
    covered: hidden.map(([el]) => {
      const r = el.getBoundingClientRect();
      return { text: label(el), clip: { x: r.left, y: r.top, width: r.width, height: r.height } };
    }),
  };
});
const frames = [];
for (const at of AT) {
  const png = await frame(at * info.narration);
  const path = resolve(shotsDir, `${String(Math.round(at * 100)).padStart(2, "0")}.png`);
  writeFileSync(path, png);
  shots.push(path);
  frames.push(png);
}
for (let i = 0; i < frames.length; i++) {
  for (let j = i + 1; j < frames.length; j++) {
    if (frames[i].equals(frames[j])) fail("SAME_FRAMES", `the frames at ${AT[i] * 100}% and ${AT[j] * 100}% are identical`);
  }
}
// The share of pixels that moved by more than a faint shade: a fade a few percent off is the same frame.
async function changed(a, b) {
  const blank = await browser.newPage();
  const share = await blank.evaluate(async ([x, y]) => {
    const load = (b64) => new Promise((r) => {
      const img = new Image();
      img.onload = () => r(img);
      img.src = `data:image/png;base64,${b64}`;
    });
    const [i, j] = await Promise.all([load(x), load(y)]);
    const c = new OffscreenCanvas(i.width, i.height).getContext("2d");
    c.drawImage(i, 0, 0);
    const p = c.getImageData(0, 0, i.width, i.height).data;
    c.drawImage(j, 0, 0);
    const q = c.getImageData(0, 0, i.width, i.height).data;
    let n = 0;
    for (let k = 0; k < p.length; k += 4) n += Math.max(Math.abs(p[k] - q[k]), Math.abs(p[k + 1] - q[k + 1]), Math.abs(p[k + 2] - q[k + 2])) > 40 ? 1 : 0;
    return n / (i.width * i.height);
  }, [a.toString("base64"), b.toString("base64")]);
  await blank.close();
  return share;
}
if ((await changed(await frame(AT[1] * info.narration), frames[1])) > 0.002) {
  fail("SEEK_UNSTABLE", "seeking to 35% twice drew two different frames; put every animation on kite.timeline, no CSS animations, timers or per-frame randomness");
}
// A kid's movie plays forward from the start, so the text scan runs on a fresh copy, forward only.
async function reopen() {
  await page.close();
  page = await open();
  await page.waitForFunction(() => (window.__kite ?? []).some((m) => m.type === "kite.ready"), null, { timeout: 5000 });
}
await reopen();
await page.addStyleTag(hidePlay);
await page.addStyleTag({ content: "#stage, #stage * { pointer-events: auto !important }" }); // so hit tests see every layer
// The guide may walk past a label and a label may slide in, but text may not stay covered or cut off.
const streak = new Map();
const reported = new Set();
for (let s = 0.5; s < info.narration; s += 0.5) {
  await page.evaluate((t) => window.kite.seek(t), s);
  const problems = await textProblems();
  if (problems === null) {
    fail("NO_GUIDE", 'give the guide character\'s group id="guide"');
    break;
  }
  const keys = problems.map(([code, text]) => `${code} ${text}`);
  for (const key of [...streak.keys()]) if (!keys.includes(key)) streak.delete(key);
  for (const [code, text, what] of problems) {
    const key = `${code} ${text}`;
    streak.set(key, (streak.get(key) ?? 0) + 1);
    const samples = code === "TEXT_COVERED" ? 3 : 2; // a second under the guide, half a second cut off
    if (streak.get(key) === samples && !reported.has(key)) {
      reported.add(key);
      fail(code, `from ${(s - (samples - 1) / 2).toFixed(1)} s ${what} "${text}"; move it`);
    }
  }
}

await reopen();
await page.evaluate((audio) => Object.assign(window.KITE_AUDIO, audio), Object.fromEntries(info.lines.map(([key, s]) => [key, silence(s)])));
await page.click("#kite-play");
await page.waitForTimeout(1000);
const t = await page.evaluate(() => window.kite.time());
if (!(t > 0.5)) fail("NO_PLAY", `one second after the play button the movie is at ${t} s`);

await browser.close();
done();
