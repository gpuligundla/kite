"use client";

import type { Brain } from "@kite/client";
import { useEffect, useRef, useState } from "react";
import { setVoiceActive } from "@/lib/sound";

/** One microphone take. `done` resolves with the audio, or null when nothing was captured or the take was refused. */
export interface Recording {
  readonly ready: Promise<void>;
  readonly done: Promise<Blob | null>;
  stop(): void;
}

export function startRecording(maxMs: number): Recording {
  let stopped = false;
  let recorder: MediaRecorder | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finish!: (b: Blob | null) => void;
  const done = new Promise<Blob | null>((resolve) => (finish = resolve));
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    if (recorder?.state === "recording") recorder.stop();
  };
  const ready = navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
    const release = () => stream.getTracks().forEach((t) => t.stop());
    // A tap shorter than the permission prompt ends before the mic opens.
    if (stopped) {
      release();
      finish(null);
      return;
    }
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream, { audioBitsPerSecond: 32_000 });
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      release();
      // The brain reads the MIME type off the upload, so the Blob must carry one.
      finish(chunks.length ? new Blob(chunks, { type: rec.mimeType.split(";")[0] || "audio/webm" }) : null);
    };
    recorder = rec;
    rec.start();
    timer = setTimeout(stop, maxMs);
  });
  ready.catch(() => finish(null));
  return { ready, done, stop };
}

/**
 * Speaks this device's sentences in order, one clip at a time, and reports whether Kite is talking.
 * `hush` stops the current clip and drops the rest, so the mic never records Kite.
 */
export function useVoice(brain: Brain, muted: boolean): { speaking: boolean; hush: () => void } {
  const [speaking, setSpeaking] = useState(false);
  const current = useRef<HTMLAudioElement | null>(null);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const hush = useRef(() => {});

  useEffect(() => {
    if (current.current) current.current.muted = muted;
  }, [muted]);

  useEffect(() => {
    let alive = true;
    const quiet = () => {
      setVoiceActive(false);
      setSpeaking(false);
    };
    const pump = () => {
      if (!alive || current.current) return;
      const clip = brain.talk.next();
      if (!clip) return;
      const audio = new Audio(`data:audio/mpeg;base64,${clip.audioB64}`);
      audio.muted = mutedRef.current;
      current.current = audio;
      setVoiceActive(true);
      setSpeaking(true);
      const ended = () => {
        if (current.current !== audio) return;
        current.current = null;
        pump();
        if (!current.current) quiet();
      };
      audio.onended = ended;
      audio.onerror = ended;
      audio.play().catch(ended);
    };
    hush.current = () => {
      current.current?.pause();
      current.current = null;
      while (brain.talk.next());
      quiet();
    };
    const unsubscribe = brain.talk.subscribe(pump);
    pump();
    return () => {
      alive = false;
      unsubscribe();
      current.current?.pause();
      current.current = null;
      setVoiceActive(false);
    };
  }, [brain]);

  return { speaking, hush: () => hush.current() };
}

/** Phone photos run 2-5 MB and a turn is capped at 900 KB, so a photo is redrawn at most 1024px on its long side. */
export async function shrinkPhoto(file: Blob, maxSide = 1024): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("photo could not be encoded"))), "image/jpeg", 0.8),
  );
}
