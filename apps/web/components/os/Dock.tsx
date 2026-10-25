"use client";

import type { DeviceKind } from "@kite/client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { playSound } from "@/lib/sound";
import { Glyph } from "./Glyph";
import { startRecording, type Recording } from "./media";
import s from "./os.module.css";

const HOLD_MAX_MS = 60_000;
const TEACH_MAX_MS = 120_000;
// Shorter than this is a tap on the diamond, not something said.
const MIN_HOLD_MS = 400;

type Mic = { phase: "idle" } | { phase: "opening" } | { phase: "on"; since: number };

export interface DockProps {
  device: DeviceKind;
  /** Teach Kite takes a long explanation: tap to start, tap to finish. Talking is hold to talk. */
  teaching: boolean;
  onSend: (text: string) => void;
  onAudio: (audio: Blob) => void;
  /** Kite stops talking when the kid starts. */
  onListen: () => void;
  onProblem: (message: string) => void;
  teachButton: ReactNode;
  photo: string | null;
  onPhoto: (file: File) => void;
  onClearPhoto: () => void;
}

export function Dock({ device, teaching, onSend, onAudio, onListen, onProblem, teachButton, photo, onPhoto, onClearPhoto }: DockProps) {
  const [text, setText] = useState("");
  const [mic, setMic] = useState<Mic>({ phase: "idle" });
  const [now, setNow] = useState(0);
  const take = useRef<Recording | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  const start = () => {
    if (take.current) return;
    onListen();
    playSound("listen");
    const rec = startRecording(teaching ? TEACH_MAX_MS : HOLD_MAX_MS);
    take.current = rec;
    let since = Date.now();
    let refused = false;
    setMic({ phase: "opening" });
    rec.ready.then(
      () => {
        since = Date.now();
        if (take.current === rec) setMic({ phase: "on", since });
      },
      () => {
        refused = true;
        onProblem("Kite can't hear you yet. Allow the microphone, then try again.");
      },
    );
    void rec.done.then((audio) => {
      if (take.current !== rec) return; // dropped when the kid left Teach Kite
      take.current = null;
      setMic({ phase: "idle" });
      if (refused) return;
      if (audio && (teaching || Date.now() - since >= MIN_HOLD_MS)) onAudio(audio);
      else if (!teaching) onProblem("Keep holding the diamond while you talk.");
    });
  };
  const stop = () => take.current?.stop();
  const toggle = () => (take.current ? stop() : start());

  const keys = useRef({ start, stop, toggle, teaching });
  keys.current = { start, stop, toggle, teaching };
  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && t.type !== "range");
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || typing(e.target)) return;
      e.preventDefault();
      if (e.repeat) return;
      if (keys.current.teaching) keys.current.toggle();
      else keys.current.start();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || typing(e.target)) return;
      e.preventDefault();
      if (!keys.current.teaching) keys.current.stop();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  useEffect(() => {
    if (mic.phase !== "on" || !teaching) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(tick);
  }, [mic, teaching]);

  // Leaving Teach Kite mid-explanation ends the take without sending it.
  useEffect(
    () => () => {
      const rec = take.current;
      take.current = null;
      rec?.stop();
      setMic({ phase: "idle" });
    },
    [teaching],
  );

  const send = () => {
    const said = text.trim() || (photo ? "What's this?" : "");
    if (!said) return;
    playSound("send");
    onSend(said);
    setText("");
  };

  const listening = mic.phase !== "idle";
  const elapsed = mic.phase === "on" ? Math.max(0, Math.floor((now - mic.since) / 1000)) : 0;
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  const label = teaching
    ? listening ? "Tap when you're done" : "Tap to start teaching"
    : listening ? "Listening…" : "Hold to talk";
  const diamond = (
    <Diamond teaching={teaching} listening={listening} label={label} clock={teaching && listening ? clock : undefined}
      start={start} stop={stop} toggle={toggle} />
  );

  return (
    <div className={s.dock} data-device={device}>
      {photo && (
        <div className={s.photo}>
          <img src={photo} alt="Your photo, sent with your next question" />
          <span>Kite will look at this</span>
          <button type="button" className={s.iconButton} onClick={onClearPhoto} aria-label="Remove the photo">
            <Glyph name="close" size={18} />
          </button>
        </div>
      )}
      <div className={s.dockRow}>
        {device === "os" && teachButton}
        <form
          className={s.typeBox}
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <textarea
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={teaching ? "Or type what you know" : "Type a question"}
            aria-label={teaching ? "Type what you know" : "Type a question for Kite"}
          />
          <button type="submit" className={s.send} disabled={!text.trim() && !photo}>
            Send
          </button>
        </form>
        {device === "os" && diamond}
      </div>
      {device === "handheld" && (
        <div className={s.handRow}>
          <button type="button" className={s.side} onClick={() => cameraInput.current?.click()}>
            <Glyph name="camera" size={26} />
            What&apos;s this?
          </button>
          <input
            ref={cameraInput}
            className={s.hidden}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onPhoto(file);
              e.target.value = "";
            }}
          />
          {diamond}
          {teachButton}
        </div>
      )}
    </div>
  );
}

function Diamond({ teaching, listening, label, clock, start, stop, toggle }: {
  teaching: boolean; listening: boolean; label: string; clock?: string; start: () => void; stop: () => void; toggle: () => void;
}) {
  const hold = teaching
    ? { onClick: toggle }
    : {
        onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          start();
        },
        onPointerUp: stop,
        onPointerCancel: stop,
        // Keyboard users press Enter: one press starts, the next one sends.
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "Enter" && !e.repeat) toggle();
        },
      };
  return (
    <div className={s.talk}>
      <button
        type="button"
        className={s.diamond}
        data-listening={listening}
        aria-pressed={listening}
        aria-label={label}
        onContextMenu={(e) => e.preventDefault()}
        {...hold}
      >
        <span className={s.diamondShape} />
        {clock ? <span className={s.clock}>{clock}</span> : <Glyph name="mic" size={30} />}
      </button>
      <span className={s.talkLabel} aria-hidden="true">
        {label}
      </span>
    </div>
  );
}
