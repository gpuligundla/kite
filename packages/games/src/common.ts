import kaplay, { type KAPLAYCtx } from "kaplay";
import type { components } from "../../client/src/contract";
import { resolveSprite } from "./sprites";

export type GameSpec = components["schemas"]["GameSpec"];
export type GameResult = { correct: number; total: number };
export type Sprites = Record<string, string>;
/** Builds the play scene. Call `finish` once, when the round is over. */
export type Play = (k: KAPLAYCtx, spec: GameSpec, finish: (r: GameResult) => void) => void;

export const W = 960;
export const H = 600;
export const SPRITE_PX = 96;
export const INK = "#263238";

/** Kid-facing text stays short and calm: at most one exclamation mark in a row. */
export const say = (text: string) => text.replace(/!+/g, "!").slice(0, 120);

export function spriteName(slug: string) {
  return `s-${slug}`;
}

/** Starts a game on the canvas with start, play and end screens. Returns the cleanup. */
export function boot(canvas: HTMLCanvasElement, spec: GameSpec, sprites: Sprites, play: Play, onFinish: (r: GameResult) => void) {
  const k = kaplay({
    canvas,
    width: W,
    height: H,
    letterbox: true,
    global: false,
    background: [227, 242, 253],
    touchToMouse: true,
    debug: false,
    font: "sans-serif",
    // A device pixel for every screen pixel, up to full screen on this display; "linear" keeps scaled art smooth.
    pixelDensity: Math.min(3, devicePixelRatio * Math.max(1, Math.min(screen.width / W, screen.height / H))),
    texFilter: "linear",
  });

  for (const slug of new Set(spec.items.map((i) => i.sprite))) k.loadSprite(spriteName(slug), resolveSprite(slug, sprites));

  const button = (label: string, y: number, onPress: () => void) => {
    const b = k.add([k.rect(360, 90, { radius: 24 }), k.color(k.rgb("#43a047")), k.pos(W / 2, y), k.anchor("center"), k.area()]);
    b.add([k.text(label, { size: 40 }), k.color(k.rgb("#ffffff")), k.anchor("center")]);
    b.onClick(onPress);
    k.onKeyPress("space", onPress);
    k.onKeyPress("enter", onPress);
  };

  k.scene("start", () => {
    k.add([k.text(say(spec.title), { size: 52, width: W - 100, align: "center" }), k.color(k.rgb(INK)), k.pos(W / 2, 140), k.anchor("center")]);
    k.add([k.text(say(spec.instructions), { size: 32, width: W - 160, align: "center" }), k.color(k.rgb(INK)), k.pos(W / 2, 290), k.anchor("center")]);
    button("Let's play", 460, () => k.go("play"));
  });

  let finished = false;
  k.scene("play", () => {
    play(k, spec, (r) => {
      if (finished) return;
      finished = true;
      k.go("end", r);
      onFinish(r);
    });
  });

  // The kid side never shows a score (DESIGN.md), so the end screen celebrates finishing. The result goes to Kite.
  k.scene("end", () => {
    k.add([k.text("Great playing!", { size: 64 }), k.color(k.rgb("#2e7d32")), k.pos(W / 2, 220), k.anchor("center")]);
    k.add([k.text("You finished the game.", { size: 44 }), k.color(k.rgb(INK)), k.pos(W / 2, 330), k.anchor("center")]);
  });

  k.onLoad(() => k.go("start"));
  return () => k.quit();
}

/** Fisher-Yates, so the round differs every time. */
export function shuffled<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
