// Proves the play-test: the good sample passes and each broken copy of it fails with its named error.
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const dir = resolve(import.meta.dirname, "samples");
const good = readFileSync(resolve(dir, "good.html"), "utf8");
const breakAt = (snippet) => good.replace("kite.ready();", snippet);
const CASES = {
  good: [good, null],
  "no-ready": [breakAt(""), "NO_READY"],
  frozen: [breakAt("kite.timeline.clear(); kite.timeline.set({}, {}, kite.movie.duration); kite.ready();"), "SAME_FRAMES"],
  unstable: [breakAt("setInterval(() => sun.setAttribute('r', 30 + Math.random() * 60), 16); kite.ready();"), "SEEK_UNSTABLE"],
  long: [breakAt("kite.timeline.to('#sun', { x: 10, duration: 30 }, 0); kite.ready();"), "BAD_DURATION"],
  forged: [good.replace("<body>", '<body><script data-kit="gsap">alert(1)</script>'), "KIT_FORGED"],
  covered: [good.replace('cx="160" cy="470" r="50"', 'cx="1080" cy="245" r="50"'), "TEXT_COVERED"],
  "no-guide": [good.replace('<g id="guide">', "<g>"), "NO_GUIDE"],
};

let ok = true;
for (const [name, [html, code]] of Object.entries(CASES)) {
  const file = resolve(dir, `case-${name}.html`);
  writeFileSync(file, html);
  const r = spawnSync("node", [resolve(import.meta.dirname, "playtest.mjs"), file], { encoding: "utf8" });
  rmSync(file);
  const verdict = JSON.parse(r.stdout.trim().split("\n").at(-1));
  const want = code === null ? verdict.passed && r.status === 0 : !verdict.passed && r.status === 1 && verdict.errors.some((e) => e.startsWith(code));
  console.log(`${want ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(verdict.errors)}`);
  ok &&= want;
}
process.exit(ok ? 0 : 1);
