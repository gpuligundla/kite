// Proves the play-test: the good samples pass and each broken sample fails with its named error.
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const dir = resolve(import.meta.dirname, "samples");
const read = (name) => readFileSync(resolve(dir, `${name}.html`), "utf8");
const good = read("good");
const phaser = read("phaser");
const KIT_PHASER = 'kite.phaser({ backgroundColor: "#0d1b3a", scene: Play })';
const KIT_KAPLAY = "kite.kaplay({ background: [16, 24, 48] })";
const CASES = {
  good: [good, null],
  phaser: [phaser, null],
  "low-res": [phaser.replace(KIT_PHASER, '{ type: Phaser.AUTO, width: 1280, height: 800, scale: { mode: Phaser.Scale.FIT }, audio: { noAudio: true }, scene: Play }'), "LOW_RES"],
  "not-fit": [good.replace(KIT_KAPLAY, "{ width: 480, height: 300, pixelDensity: 2, global: false }"), "NOT_FIT"],
  throws: [read("throws"), "GAME_ERROR"],
  "no-ready": [read("no-ready"), "NO_READY"],
  frozen: [read("frozen"), "CANVAS_FROZEN"],
  "no-solve": [good.replace("window.kiteTest = ", "window.notKiteTest = "), "NOT_FINISHABLE"],
  "wrong-solve": [good.replace("while (total < 10) choose(true);", "while (total < 10) choose(total > 0);"), "NOT_FINISHABLE"],
  forged: [good.replace("<body>", '<body><script data-kit="kaplay">alert(1)</script>'), "KIT_FORGED"],
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
