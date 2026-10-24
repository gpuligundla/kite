// Writes a small sample creation (2 scenes, inline SVG sprites, generated-tone WAVs) next to this file.
// Run: node packages/movie/sample/make-sample.mjs && node packages/movie/render.mjs packages/movie/sample/creation.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const RATE = 16000;

function wav(seconds, hz) {
  const n = Math.round(seconds * RATE);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const fade = Math.min(1, i / 400, (n - i) / 400);
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / RATE) * 3000 * fade), 44 + i * 2);
  }
  return buf;
}

const words = (text, seconds) => {
  const w = text.split(" ");
  return w.map((t, i) => ({ text: t, start: +((i * seconds) / w.length).toFixed(2), end: +(((i + 1) * seconds) / w.length).toFixed(2) }));
};

const lines = [
  ["0-0", "Hi! I am Rexy the dinosaur.", 2.0, 330],
  ["0-1", "And I am Pip. Look at the big blue sky!", 2.5, 440],
  ["1-0", "Light from the sun looks white but hides every color.", 3.0, 330],
];

const audio = {};
const timings = {};
fs.mkdirSync(path.join(dir, "audio"), { recursive: true });
for (const [key, text, secs, hz] of lines) {
  fs.writeFileSync(path.join(dir, "audio", `${key}.wav`), wav(secs, hz));
  audio[key] = `audio/${key}.wav`;
  timings[key] = words(text, secs);
}

const svg = (fill, shape) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g fill="${fill}">${shape}</g><circle cx="44" cy="22" r="3" fill="#fff"/></svg>`;
const sprites = {
  rexy: svg("#43a047", '<path d="M10 56 L10 36 Q10 20 26 20 L40 20 L40 10 L56 10 L56 24 L46 24 L46 44 L36 44 L36 56 L28 56 L28 46 L20 46 L20 56 Z"/>'),
  pip: svg("#fb8c00", '<circle cx="32" cy="34" r="22"/><polygon points="20,18 24,4 32,16"/><polygon points="44,18 40,4 32,16"/>'),
};

const palette = (sky, ground, time_of_day) => ({ sky, ground, time_of_day });
const creation = {
  id: "sample",
  kind: "movie",
  status: "ready",
  storyboard: {
    title: "Why is the sky blue?",
    scenes: [
      {
        background: "sky",
        palette: palette("#81d4fa", "#7cb342", "day"),
        camera: "pan",
        actors: [
          { sprite: "rexy", name: "Rexy", entrance: "left", motion: "bounce" },
          { sprite: "pip", name: "Pip", entrance: "pop", motion: "float" },
        ],
        lines: [
          { speaker: "Rexy", voice: "narrator", text: lines[0][1] },
          { speaker: "Pip", voice: "explorer", text: lines[1][1] },
        ],
      },
      {
        background: "space",
        palette: palette("#1a237e", "#9e9e9e", "night"),
        camera: "zoom",
        actors: [{ sprite: "rexy", name: "Rexy", entrance: "right", motion: "walk" }],
        lines: [{ speaker: "Rexy", voice: "narrator", text: lines[2][1] }],
      },
    ],
    check: {
      question: "What color is sunlight really?",
      choices: ["Only yellow", "All the colors mixed", "Only blue"],
      correct_index: 1,
      concept_id: "light_colors",
    },
  },
  game: null,
  audio,
  timings,
  video_url: null,
  html_url: null,
  sprites,
};
fs.writeFileSync(path.join(dir, "creation.json"), JSON.stringify(creation, null, 2));
console.log("wrote", path.join(dir, "creation.json"));
