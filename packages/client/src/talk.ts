import type { components } from "./contract.d.ts";

export type KiteEvent = components["schemas"]["KiteEvent"];
type RouteName = components["schemas"]["AnswerDoneEvent"]["route"];

declare const turnBrand: unique symbol;
/** A ULID the brain minted for POST /turns. Only `say()` and the reducer create one. */
export type TurnId = string & { readonly [turnBrand]: true };

/** The key for events that belong to no turn (the teach opener). `turn_id` is null on the wire. */
export const NO_TURN = "no-turn" as const;
export type TurnKey = TurnId | typeof NO_TURN;

const MAX_TURNS = 24;

export interface Sentence {
  readonly text: string;
  /** Base64 MP3. "" when the brain has no voice or text-to-speech failed. The text still counts. */
  readonly audioB64: string;
}

export interface TurnDone {
  /** What was spoken after the last reset, not the sum of every sentence received. */
  readonly text: string;
  readonly fkGrade: number | null;
  readonly deeper: boolean;
  readonly route: RouteName;
}

/** `sentences[i]` is sentence index i with no holes, so the UI renders it as is and the player takes the next one in order. */
export interface TurnView {
  readonly id: TurnKey;
  /** This client posted the turn, so this device speaks it. Both kid devices receive every kid event. */
  readonly mine: boolean;
  readonly heard?: string;
  readonly sentences: readonly Sentence[];
  readonly done?: TurnDone;
  /** Sentences handed to the player or skipped for having no audio. */
  readonly played: number;
  /** Reducer bookkeeping. Highest event id applied to this turn, so a replayed frame is at or below it. */
  readonly seen: number;
  /** Reducer bookkeeping. Sentences that arrived ahead of a gap, keyed by index. */
  readonly early: Readonly<Record<number, Sentence>>;
}

/** Turns in arrival order, newest 24. The one structure for rendering, folding events and speaking. */
export interface TalkState {
  readonly turns: readonly TurnView[];
}

/** One sentence ready to play. `audioB64` is never "". */
export interface Clip {
  readonly turn: TurnKey;
  readonly index: number;
  readonly text: string;
  readonly audioB64: string;
}

export const emptyTalk: TalkState = { turns: [] };

/** Pure and idempotent. A no-op returns the same reference, so subscribers are not woken for `decided` or `recalled`. */
export function reduceTalk(state: TalkState, e: KiteEvent): TalkState {
  if (e.type !== "heard" && e.type !== "answer.sentence" && e.type !== "answer.done") return state;
  const id = (e.turn_id ?? NO_TURN) as TurnKey;
  return upsert(state, id, (t) => {
    // Per turn, never global: ids restart at 1 when the brain restarts, but a turn id never spans two brain lives.
    // Id 0 is the pydantic default for "unpublished", so hand-built events skip the guard.
    if (e.id !== 0 && e.id <= t.seen) return t;
    const seen = id === NO_TURN ? 0 : Math.max(t.seen, e.id);
    switch (e.type) {
      case "heard":
        return { ...t, seen, heard: e.text };
      case "answer.done":
        return { ...t, seen, done: { text: e.text, fkGrade: e.fk_grade, deeper: e.depth_override, route: e.route } };
      case "answer.sentence": {
        const next = withSentence(t, e.index, { text: e.text, audioB64: e.audio_b64 });
        return next === t ? t : { ...next, seen };
      }
    }
  });
}

/**
 * Claiming creates the turn when its first event has not arrived yet, because events can beat the POST response.
 * The placeholder doubles as a "thinking" bubble. Releasing an unknown turn is a no-op.
 */
export function setClaim(state: TalkState, id: TurnKey, mine: boolean): TalkState {
  return upsert(state, id, (t) => {
    if (t.mine === mine) return t;
    // Every teach opener shares one key and is claimed before it is posted, so what is already there came from the other device.
    const played = mine && id === NO_TURN ? t.sentences.length : t.played;
    return { ...t, mine, played };
  });
}

/**
 * The player's pull. Among claimed turns the earliest to arrive that has an unplayed sentence wins, and within a
 * turn index order. A turn still streaming never blocks a later one, so a lost `answer.done` cannot silence the device.
 * Skipped silence advances the cursor even when no clip comes back.
 */
export function takeClip(state: TalkState): readonly [TalkState, Clip | undefined] {
  const turns = [...state.turns];
  let skipped = false;
  for (const [i, t] of turns.entries()) {
    if (!t.mine) continue;
    let played = t.played;
    while (played < t.sentences.length && t.sentences[played].audioB64 === "") played++;
    if (played === t.sentences.length) {
      if (played !== t.played) {
        turns[i] = { ...t, played };
        skipped = true;
      }
      continue;
    }
    const { text, audioB64 } = t.sentences[played];
    // The opener has no answer.done to end it, so its claim dies with its first clip.
    turns[i] = { ...t, played: played + 1, mine: t.id !== NO_TURN };
    return [{ turns }, { turn: t.id, index: played, text, audioB64 }];
  }
  return [skipped ? { turns } : state, undefined];
}

function upsert(state: TalkState, id: TurnKey, change: (t: TurnView) => TurnView): TalkState {
  const at = state.turns.findIndex((t) => t.id === id);
  const current = at < 0 ? blank(id) : state.turns[at];
  const next = change(current);
  if (next === current) return state;
  if (at >= 0) return { turns: state.turns.map((t, i) => (i === at ? next : t)) };
  return { turns: [...state.turns, next].slice(-MAX_TURNS) };
}

function blank(id: TurnKey): TurnView {
  return { id, mine: false, sentences: [], played: 0, seen: 0, early: {} };
}

function withSentence(t: TurnView, index: number, s: Sentence): TurnView {
  const n = t.sentences.length;
  // The brain's "discard what you heard of this turn": flagged output sends 0 twice, and the catch-all after done sends 0 again.
  if (index === 0 && n > 0) return { ...t, sentences: [s], early: {}, played: 0 };
  if (index > n) return { ...t, early: { ...t.early, [index]: s } };
  if (index < n) return t;
  const sentences = [...t.sentences, s];
  const early: Record<number, Sentence> = { ...t.early };
  while (sentences.length in early) {
    sentences.push(early[sentences.length]);
    delete early[sentences.length - 1];
  }
  return { ...t, sentences, early };
}
