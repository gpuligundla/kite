"use client";

import { createBrain, type Brain, type DeviceKind, type KiteEvent, type TalkState } from "@kite/client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

export const KID_ID = process.env.NEXT_PUBLIC_KID_ID ?? "maya";

/** One brain client per page, authenticated by the kite_token cookie through the /brain proxy. */
export function useBrain(device: DeviceKind): Brain {
  const [brain] = useState(() => createBrain({ baseUrl: "/brain", kidId: KID_ID, device, auth: { kind: "cookie" } }));
  return brain;
}

/** Talk state (heard, sentences, done) for every turn on this kid's stream. */
export function useTalk(brain: Brain): TalkState {
  return useSyncExternalStore(brain.talk.subscribe, brain.talk.getState, brain.talk.getState);
}

/** Raw stream events. The latest handler is always used, so callers needn't memoize it. */
export function useBrainEvents(brain: Brain, onEvent: (e: KiteEvent) => void): void {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => brain.subscribe((e) => handler.current(e)), [brain]);
}
