// Proves the play-test: the good sample passes and each broken sample fails with its named error.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const EXPECT = { good: null, throws: "GAME_ERROR", "no-ready": "NO_READY", frozen: "CANVAS_FROZEN" };

let ok = true;
for (const [name, code] of Object.entries(EXPECT)) {
  const r = spawnSync("node", [resolve(import.meta.dirname, "playtest.mjs"), resolve(import.meta.dirname, "samples", `${name}.html`)], { encoding: "utf8" });
  const verdict = JSON.parse(r.stdout.trim().split("\n").at(-1));
  const want = code === null ? verdict.passed && r.status === 0 : !verdict.passed && r.status === 1 && verdict.errors.some((e) => e.startsWith(code));
  console.log(`${want ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(verdict.errors)}`);
  ok &&= want;
}
process.exit(ok ? 0 : 1);
