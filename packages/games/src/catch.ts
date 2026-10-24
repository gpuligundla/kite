import type { Play } from "./common";
import { H, INK, SPRITE_PX, W, say, shuffled, spriteName } from "./common";

const ITEMS_PER_ROUND = 10;
const SPAWN_EVERY_S = 1.3;
const FALL_PX_PER_S = 150;
const CATCHER_W = 170;
const CATCHER_SPEED = 560;
const CATCHER_Y = H - 50;

/**
 * Items fall one at a time. Catching a correct one scores a point, catching a wrong one takes a point back.
 * `total` is the number of correct items that fell.
 */
export const playCatch: Play = (k, spec, finish) => {
  // Half correct, half not, so doing nothing never scores.
  const correct = spec.items.filter((i) => i.correct);
  const wrong = spec.items.filter((i) => !i.correct);
  const queue = shuffled(
    Array.from({ length: ITEMS_PER_ROUND }, (_, n) => {
      const pool = (n % 2 === 0 ? correct : wrong);
      const from = pool.length > 0 ? pool : spec.items;
      return from[Math.floor(Math.random() * from.length)];
    }),
  );
  const total = queue.filter((i) => i.correct).length;

  let score = 0;
  let spawned = 0;
  let falling = 0;

  k.add([k.text(say(spec.instructions), { size: 28, width: W - 260 }), k.color(k.rgb(INK)), k.pos(24, 18)]);
  const hud = k.add([k.text("0", { size: 56 }), k.color(k.rgb("#2e7d32")), k.pos(W - 30, 18), k.anchor("topright")]);
  const note = k.add([k.text("", { size: 36 }), k.color(k.rgb("#c62828")), k.pos(W / 2, 110), k.anchor("center")]);

  const catcher = k.add([
    k.rect(CATCHER_W, 44, { radius: 16 }),
    k.color(k.rgb("#fb8c00")),
    k.pos(W / 2, CATCHER_Y),
    k.anchor("center"),
  ]);
  const clampX = (x: number) => Math.min(W - CATCHER_W / 2, Math.max(CATCHER_W / 2, x));

  k.onMouseMove(() => {
    catcher.pos.x = clampX(k.mousePos().x);
  });
  k.onUpdate(() => {
    const dir = (k.isKeyDown("right") ? 1 : 0) - (k.isKeyDown("left") ? 1 : 0);
    catcher.pos.x = clampX(catcher.pos.x + dir * CATCHER_SPEED * k.dt());
  });

  const resolve = (isCorrect: boolean, caught: boolean, label: string) => {
    falling--;
    if (caught && isCorrect) {
      score++;
      note.text = "";
    } else if (caught) {
      score = Math.max(0, score - 1);
      note.text = say(`Not ${label}. Keep looking`);
    }
    hud.text = String(score);
    if (spawned === queue.length && falling === 0) k.wait(0.6, () => finish({ correct: score, total }));
  };

  const spawn = () => {
    const item = queue[spawned++];
    falling++;
    const obj = k.add([
      k.sprite(spriteName(item.sprite), { width: SPRITE_PX, height: SPRITE_PX }),
      k.pos(SPRITE_PX / 2 + Math.random() * (W - SPRITE_PX), -SPRITE_PX),
      k.anchor("center"),
    ]);
    obj.add([k.text(item.label, { size: 26 }), k.color(k.rgb(INK)), k.pos(0, SPRITE_PX / 2 + 14), k.anchor("center")]);
    obj.onUpdate(() => {
      obj.pos.y += FALL_PX_PER_S * k.dt();
      const reachesCatcher = obj.pos.y + SPRITE_PX / 2 >= CATCHER_Y - 22 && Math.abs(obj.pos.x - catcher.pos.x) < CATCHER_W / 2 + SPRITE_PX / 3;
      if (reachesCatcher || obj.pos.y > H + SPRITE_PX) {
        obj.destroy();
        resolve(!!item.correct, reachesCatcher, item.label);
      }
    });
  };

  k.loop(SPAWN_EVERY_S, spawn, ITEMS_PER_ROUND, true);
};
