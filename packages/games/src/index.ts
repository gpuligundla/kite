import { playCatch } from "./catch";
import { boot, type GameResult, type GameSpec, type Sprites } from "./common";
import { playSort } from "./sort";

export type { GameResult, GameSpec, Sprites };
export { sortLayout } from "./sort";

/**
 * Mounts a template game on the canvas. `onFinish` is called once, when the end screen appears.
 * `sprites` maps slug to a data: URL; slugs not listed get a generated badge. Returns the cleanup.
 */
export function mountGame(
  canvas: HTMLCanvasElement,
  spec: GameSpec,
  onFinish: (r: GameResult) => void,
  sprites: Sprites = {},
): () => void {
  return boot(canvas, spec, sprites, spec.template === "catch" ? playCatch : playSort, onFinish);
}
