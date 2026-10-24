"use client";

import type { Band } from "./band";

/** Files in public/sounds, generated with ElevenLabs sound effects and loudness-matched at -22 LUFS. */
export type SoundName = "send" | "listen" | "ready" | "cheer" | "correct" | "oops" | "whoosh" | "sent";

const ALL: SoundName[] = ["send", "listen", "ready", "cheer", "correct", "oops", "whoosh", "sent"];
// Younger kids hear every sound. Teens hear only confirmations that something they're waiting for happened.
const HEARD: Record<Band, ReadonlySet<SoundName>> = {
  k2: new Set(ALL),
  g35: new Set(ALL),
  g68: new Set<SoundName>(["listen", "ready", "cheer", "correct", "sent"]),
  g912: new Set<SoundName>(["listen", "ready", "sent"]),
};
const VOLUME: Record<Band, number> = { k2: 0.9, g35: 0.8, g68: 0.6, g912: 0.45 };
const MUTE_KEY = "kite-muted";

let band: Band = "g35";
let voiceActive = false;
let muted = readMuted();
const loaded = new Map<SoundName, HTMLAudioElement>();

function readMuted(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSoundBand(b: Band): void {
  band = b;
}

/** While Kite is speaking, UI sounds stay quiet so they never talk over the voice. A celebration still plays. */
export function setVoiceActive(active: boolean): void {
  voiceActive = active;
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    window.localStorage.setItem(MUTE_KEY, value ? "1" : "0");
  } catch {
    // Private windows can refuse storage; the setting then lasts for this page only.
  }
}

export function playSound(name: SoundName): void {
  if (typeof window === "undefined" || muted || !HEARD[band].has(name) || (voiceActive && name !== "cheer")) return;
  let base = loaded.get(name);
  if (!base) {
    base = new Audio(`/sounds/${name}.mp3`);
    base.preload = "auto";
    loaded.set(name, base);
  }
  const a = base.cloneNode() as HTMLAudioElement;
  a.volume = VOLUME[band];
  void a.play().catch(() => {}); // autoplay rules can block a sound before the first tap; that's fine
}
