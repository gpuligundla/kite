import type { components } from "../../client/src/contract";

export type Creation = components["schemas"]["Creation"];
type Word = components["schemas"]["Word"];

export const MOVIE_FPS = 30;
export const MOVIE_WIDTH = 1280;
export const MOVIE_HEIGHT = 720;

const GAP_SECONDS = 0.5;
/** The check question stays up this long after the last scene's gap. */
const CHECK_HOLD_SECONDS = 0.5;
/** Used only when a line has no timings: about 3 words a second. */
const SECONDS_PER_WORD = 0.35;

export interface TimelineWord {
  text: string;
  fromFrame: number;
  toFrame: number;
}
export interface TimelineLine {
  /** Absolute frame where the line starts. */
  from: number;
  durationInFrames: number;
  speaker: string;
  /** The key into `creation.audio` and `creation.timings`. */
  key: string;
  words: TimelineWord[];
}
export interface TimelineScene {
  from: number;
  durationInFrames: number;
  lines: TimelineLine[];
}
export interface Timeline {
  durationInFrames: number;
  scenes: TimelineScene[];
  /** Frame where the check question appears: the gap after the last scene. */
  checkFrom: number;
}

/** Audio and timings are keyed "<sceneIndex>-<lineIndex>", for example "1-0". */
export const lineKey = (scene: number, line: number) => `${scene}-${line}`;

function lineSeconds(words: Word[] | undefined, text: string): number {
  if (words && words.length > 0) return Math.max(...words.map((w) => w.end));
  return text.split(/\s+/).filter(Boolean).length * SECONDS_PER_WORD;
}

export function buildTimeline(creation: Creation, fps = MOVIE_FPS): Timeline {
  const storyboard = creation.storyboard;
  if (!storyboard) throw new Error("creation has no storyboard");
  const gap = Math.round(GAP_SECONDS * fps);

  let cursor = 0;
  const scenes = storyboard.scenes.map((scene, s): TimelineScene => {
    const sceneFrom = cursor;
    const lines = scene.lines.map((line, l): TimelineLine => {
      const key = lineKey(s, l);
      const words = creation.timings[key];
      const from = cursor;
      const durationInFrames = Math.round(lineSeconds(words, line.text) * fps);
      cursor += durationInFrames;
      return {
        from,
        durationInFrames,
        speaker: line.speaker,
        key,
        words: (words ?? []).map((w) => ({
          text: w.text,
          fromFrame: from + Math.round(w.start * fps),
          toFrame: from + Math.round(w.end * fps),
        })),
      };
    });
    const durationInFrames = cursor - sceneFrom;
    cursor += gap;
    return { from: sceneFrom, durationInFrames, lines };
  });

  return {
    scenes,
    checkFrom: cursor - gap,
    durationInFrames: cursor + Math.round(CHECK_HOLD_SECONDS * fps),
  };
}
