// Run: npm -w packages/movie run check
import assert from "node:assert/strict";
import { buildTimeline, type Creation } from "../src/timeline.ts";

const palette = { sky: "#87ceeb", ground: "#7cb342", time_of_day: "day" as const };
const scene = (text: string) => ({
  background: "sky" as const,
  palette,
  actors: [],
  camera: "still" as const,
  lines: [{ speaker: "Rexy", voice: "narrator" as const, text }],
});

const creation: Creation = {
  id: "t",
  kind: "movie",
  status: "ready",
  storyboard: {
    title: "t",
    scenes: [scene("hello there"), scene("bye now")],
    check: { question: "q?", choices: ["a", "b"], correct_index: 0, concept_id: "c" },
  },
  game: null,
  audio: { "0-0": "0-0.mp3", "1-0": "1-0.mp3", music: "music.mp3", check: "check.mp3" },
  timings: {
    "0-0": [{ text: "hello", start: 0, end: 1.5 }, { text: "there", start: 1.5, end: 3.0 }],
    "1-0": [{ text: "bye", start: 0, end: 1.0 }, { text: "now", start: 1.0, end: 2.5 }],
  },
  video_url: null,
  html_url: null,
};

const t = buildTimeline(creation, 30);
assert.equal(t.scenes[0].from, 0);
assert.equal(t.scenes[0].durationInFrames, 90);
assert.equal(t.scenes[1].from, 105);
assert.equal(t.scenes[1].durationInFrames, 75);
assert.equal(t.durationInFrames, 210);
assert.deepEqual(t.scenes[1].lines[0].words[1], { text: "now", fromFrame: 105 + 30, toFrame: 105 + 75 });
assert.deepEqual(t.scenes.flatMap((s) => s.lines.map((l) => l.key)), ["0-0", "1-0"], "music and check are not lines");
console.log("timeline ok:", t.durationInFrames, "frames");
