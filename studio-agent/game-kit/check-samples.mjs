// Proves the play-test: the good samples pass and each broken sample fails with its named error.
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const dir = resolve(import.meta.dirname, "samples");
const read = (name) => readFileSync(resolve(dir, `${name}.html`), "utf8");
const good = read("good");
const CASES = {
  good: [good, null],
  phaser: [read("phaser"), null],
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
