#!/usr/bin/env node
// Usage: node packages/movie/render.mjs <creation.json> [--still <frame>]
// Writes movie.mp4 (or still.png) next to creation.json.
//
// creation.json is a Creation. Audio values that are not http(s)/data URLs are file paths,
// resolved against the creation.json folder. An optional top-level "sprites" map
// {slug: data URL | <svg markup> | file path} supplies art for the actors.
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const isUrl = (v) => /^(https?:|data:)/.test(v);

function fail(message) {
  console.error(`render failed: ${message}`);
  process.exit(1);
}

function readFile(dir, rel, what) {
  const file = path.resolve(dir, rel);
  if (!fs.existsSync(file)) fail(`${what} not found: ${file}`);
  return file;
}

/** Copies local audio into the bundle's public dir and returns the creation with bundle-relative paths. */
function prepare(creation, dir, publicDir) {
  const audio = {};
  for (const [key, value] of Object.entries(creation.audio ?? {})) {
    if (isUrl(value)) {
      audio[key] = value;
      continue;
    }
    const file = readFile(dir, value, `audio "${key}"`);
    const name = `audio/${key}${path.extname(file)}`;
    fs.mkdirSync(path.join(publicDir, "audio"), { recursive: true });
    fs.copyFileSync(file, path.join(publicDir, name));
    audio[key] = name;
  }

  const sprites = {};
  for (const [slug, value] of Object.entries(creation.sprites ?? {})) {
    if (isUrl(value)) sprites[slug] = value;
    else if (value.trimStart().startsWith("<svg")) sprites[slug] = `data:image/svg+xml;utf8,${encodeURIComponent(value)}`;
    else {
      const file = readFile(dir, value, `sprite "${slug}"`);
      const svg = file.endsWith(".svg");
      const body = svg ? encodeURIComponent(fs.readFileSync(file, "utf8")) : fs.readFileSync(file).toString("base64");
      sprites[slug] = svg ? `data:image/svg+xml;utf8,${body}` : `data:image/${path.extname(file).slice(1)};base64,${body}`;
    }
  }

  const { sprites: _ignored, ...rest } = creation;
  return { creation: { ...rest, audio }, sprites };
}

async function main() {
  const args = process.argv.slice(2);
  const stillAt = args.includes("--still") ? Number(args[args.indexOf("--still") + 1]) : null;
  const input = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--still");
  if (!input) fail("usage: node render.mjs <creation.json> [--still <frame>]");

  const jsonPath = path.resolve(input);
  const dir = path.dirname(jsonPath);
  let creation;
  try {
    creation = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  } catch (e) {
    fail(`cannot read ${jsonPath}: ${e.message}`);
  }
  if (!creation.storyboard) fail("creation has no storyboard");

  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "kite-movie-"));
  try {
    const inputProps = prepare(creation, dir, publicDir);
    await ensureBrowser();
    const serveUrl = await bundle({ entryPoint: path.join(here, "src/Root.tsx"), publicDir });
    const composition = await selectComposition({ serveUrl, id: "KiteMovie", inputProps });

    if (stillAt !== null) {
      const output = path.join(dir, "still.png");
      await renderStill({ composition, serveUrl, inputProps, frame: stillAt, output });
      console.log(`wrote ${output}`);
      return;
    }
    const outputLocation = path.join(dir, "movie.mp4");
    await renderMedia({ composition, serveUrl, inputProps, codec: "h264", outputLocation });
    console.log(`wrote ${outputLocation} (${composition.durationInFrames} frames)`);
  } finally {
    fs.rmSync(publicDir, { recursive: true, force: true });
  }
}

main().catch((e) => fail(e?.message ?? String(e)));
