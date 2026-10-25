import type { KiteEvent } from "@kite/client";

export type CreationKind = "movie" | "game";
export type CreationStatus = "making" | "ready" | "fallback";

export interface CreationEntry {
  readonly id: string;
  readonly kind: CreationKind | "story"; // CreationKind is what the kid can ask to make from a turn
  readonly status: CreationStatus;
  readonly progress?: { readonly step: number; readonly total: number };
  readonly videoUrl?: string;
}

/** Newest first, keyed by creation id. The stream replays recent events, so earlier creations show up too. */
export type Creations = readonly CreationEntry[];

export function reduceCreations(list: Creations, e: KiteEvent): Creations {
  if (e.type !== "creation.progress" && e.type !== "creation.ready" && e.type !== "creation.video") return list;
  const prev = list.find((c) => c.id === e.creation_id);
  let next: CreationEntry | undefined;
  if (e.type === "creation.progress") {
    next = { id: e.creation_id, kind: e.kind, status: prev?.status ?? "making", ...prev, progress: { step: e.step, total: e.steps_total } };
  } else if (e.type === "creation.ready") {
    next = { ...prev, id: e.creation_id, kind: e.kind, status: e.status };
  } else if (prev) {
    next = { ...prev, videoUrl: e.video_url };
  }
  if (!next) return list;
  return [next, ...list.filter((c) => c.id !== e.creation_id)];
}
