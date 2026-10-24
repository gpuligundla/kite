import type { GameSpec, Play } from "./common";
import { H, INK, SPRITE_PX, W, say, spriteName } from "./common";

const COLS = 4;
const BIN_COLORS = ["#ffcc80", "#a5d6a7", "#ce93d8"];

export interface Layout {
  items: { x: number; y: number }[];
  bins: { x: number; y: number; w: number; h: number }[];
}

/** Item start points in a grid at the top, bins side by side at the bottom. Pure, so a check can aim at it. */
export function sortLayout(spec: GameSpec): Layout {
  const items = spec.items.map((_, i) => ({
    x: W / 2 + (((i % COLS) - (COLS - 1) / 2) * (W - 120)) / COLS,
    y: 150 + Math.floor(i / COLS) * 130,
  }));
  const n = spec.bins.length;
  const w = (W - 60 - (n - 1) * 20) / n;
  const bins = spec.bins.map((_, i) => ({ x: 30 + w / 2 + i * (w + 20), y: H - 90, w, h: 150 }));
  return { items, bins };
}

/** The kid drags each item into a bin. A first-try drop in the right bin scores. `total` is the item count. */
export const playSort: Play = (k, spec, finish) => {
  const layout = sortLayout(spec);
  const note = k.add([k.text("", { size: 32 }), k.color(k.rgb("#c62828")), k.pos(W / 2, 50), k.anchor("center")]);
  k.add([k.text(say(spec.instructions), { size: 26, width: W - 60, align: "center" }), k.color(k.rgb(INK)), k.pos(W / 2, 20), k.anchor("top")]);

  layout.bins.forEach((b, i) => {
    k.add([k.rect(b.w, b.h, { radius: 24 }), k.color(k.rgb(BIN_COLORS[i % BIN_COLORS.length])), k.pos(b.x, b.y), k.anchor("center")]);
    k.add([k.text(spec.bins[i], { size: 34 }), k.color(k.rgb(INK)), k.pos(b.x, b.y - b.h / 2 + 24), k.anchor("center")]);
  });

  let correct = 0;
  let placed = 0;
  const placedIn = spec.bins.map(() => 0);

  const objs = spec.items.map((item, i) => {
    const home = layout.items[i];
    const obj = k.add([k.sprite(spriteName(item.sprite), { width: SPRITE_PX, height: SPRITE_PX }), k.pos(home.x, home.y), k.anchor("center"), k.scale(1), k.z(1)]);
    obj.add([k.text(item.label, { size: 24 }), k.color(k.rgb(INK)), k.pos(0, SPRITE_PX / 2 + 14), k.anchor("center")]);
    return { obj, item, home, tries: 0, done: false };
  });

  let held: { entry: (typeof objs)[number]; dx: number; dy: number } | null = null;

  k.onMousePress(() => {
    const m = k.mousePos();
    const hit = [...objs].reverse().find((e) => !e.done && Math.abs(e.obj.pos.x - m.x) < SPRITE_PX / 2 && Math.abs(e.obj.pos.y - m.y) < SPRITE_PX / 2 + 16);
    if (hit) held = { entry: hit, dx: hit.obj.pos.x - m.x, dy: hit.obj.pos.y - m.y };
  });
  k.onMouseMove(() => {
    if (!held) return;
    const m = k.mousePos();
    held.entry.obj.pos = k.vec2(m.x + held.dx, m.y + held.dy);
    held.entry.obj.z = 10;
  });
  k.onMouseRelease(() => {
    if (!held) return;
    const e = held.entry;
    held = null;
    e.obj.z = 1;
    const { x, y } = e.obj.pos;
    const binIndex = layout.bins.findIndex((b) => Math.abs(x - b.x) < b.w / 2 && Math.abs(y - b.y) < b.h / 2);
    if (binIndex < 0 || spec.bins[binIndex] !== e.item.bin) {
      if (binIndex >= 0) {
        e.tries++;
        note.text = say(`${e.item.label} doesn't go there. Try again`);
      }
      e.obj.pos = k.vec2(e.home.x, e.home.y);
      return;
    }
    note.text = "";
    if (e.tries === 0) correct++;
    e.done = true;
    const b = layout.bins[binIndex];
    const slot = placedIn[binIndex]++;
    e.obj.scale = k.vec2(0.7);
    e.obj.pos = k.vec2(b.x - b.w / 2 + 60 + (slot % 3) * 80, b.y + 8 + Math.floor(slot / 3) * 50);
    if (++placed === spec.items.length) k.wait(0.8, () => finish({ correct, total: spec.items.length }));
  });
};
