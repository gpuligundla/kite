// Play-test one movie.html the way the Kite OS iframe will run it: inlined, offline, headless, 1280x720.
// Usage: node playtest.mjs [movie.html]   Writes dist/movie.html and shots/*.png next to the source,
// prints a JSON verdict {passed, errors, out, shots, duration, narration} and exits 1 on failure.
// Error codes, so the agent can fix the right thing: KIT_FORGED, MOVIE_ERROR, NO_READY, BAD_DURATION,
// SAME_FRAMES, SEEK_UNSTABLE, NO_PLAY, NETWORK.
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
}, 60000);

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.route("**/*", (route) => {
  if (route.request().url() === PAGE) return route.fulfill({ contentType: "text/html", body: html, headers: { "Content-Security-Policy": CSP } });
  fail("NETWORK", route.request().url());
  return route.abort();
});
page.on("pageerror", (e) => fail("MOVIE_ERROR", e.message));
page.on("console", (m) => m.type() === "error" && fail("MOVIE_ERROR", m.text()));

await page.goto(PAGE, { waitUntil: "load" });
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

const hidePlay = await page.addStyleTag({ content: "#kite-play{display:none!important}" });
const frame = async (seconds) => {
  await page.evaluate((s) => window.kite.seek(s), seconds);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page.screenshot();
};
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
if (!(await frame(AT[1] * info.narration)).equals(frames[1])) {
  fail("SEEK_UNSTABLE", "seeking to 35% twice drew two different frames; put every animation on kite.timeline, no CSS animations, timers or per-frame randomness");
}

await page.evaluate((audio) => Object.assign(window.KITE_AUDIO, audio), Object.fromEntries(info.lines.map(([key, s]) => [key, silence(s)])));
await page.evaluate(() => window.kite.seek(0));
await hidePlay.evaluate((tag) => tag.remove());
await page.click("#kite-play");
await page.waitForTimeout(1000);
const t = await page.evaluate(() => window.kite.time());
if (!(t > 0.5)) fail("NO_PLAY", `one second after the play button the movie is at ${t} s`);

await browser.close();
done();
