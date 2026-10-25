"use client";

import type { DeviceKind } from "@kite/client";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { SPRING, type Band } from "@/lib/band";
import { playSound } from "@/lib/sound";
import { Glyph } from "./Glyph";
import { startRecording, type Recording } from "./media";
import s from "./os.module.css";

const HOLD_MAX_MS = 60_000;
const TEACH_MAX_MS = 120_000;
// Shorter than this is a tap on the diamond, not something said.
const MIN_HOLD_MS = 400;

type Mic = { phase: "idle" } | { phase: "opening" } | { phase: "on"; since: number };
/** What the diamond shows. Listening wins over thinking: the kid can always talk over Kite. */
type Look = "ready" | "listening" | "thinking";

export interface DockProps {
  device: DeviceKind;
  band: Band;
  /** Teach Kite takes a long explanation: tap to start, tap to finish. Talking is hold to talk. */
  teaching: boolean;
  /** Kite has the kid's question and hasn't started answering it. */
  thinking: boolean;
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

/** Talking is the way in. Typing is a backup behind a toggle, remembered per device. */
export function Dock({ device, band, teaching, thinking, onSend, onAudio, onListen, onProblem, teachButton, photo, onPhoto, onClearPhoto }: DockProps) {
  const [text, setText] = useState("");
  const [mic, setMic] = useState<Mic>({ phase: "idle" });
  const [now, setNow] = useState(0);
  const [typing, setTyping] = useState(false);
  const take = useRef<Recording | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const focusBox = useRef(false);
  const remembered = `kite.dock.${device}`;

  // Read after mount: the server render can't see this browser's choice.
  useEffect(() => {
    try {
      setTyping(localStorage.getItem(remembered) === "type");
    } catch {
      // Storage blocked: talking stays the default.
    }
  }, [remembered]);
  useEffect(() => {
    if (typing && focusBox.current) box.current?.focus();
    focusBox.current = false;
  }, [typing]);
  const chooseTyping = (next: boolean) => {
    focusBox.current = next;
    setTyping(next);
    try {
      localStorage.setItem(remembered, next ? "type" : "talk");
    } catch {
      // Storage blocked: the choice lasts until reload.
    }
  };

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
    const typingHere = (t: EventTarget | null) => t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && t.type !== "range");
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || typingHere(e.target)) return;
      e.preventDefault();
      if (e.repeat) return;
      if (keys.current.teaching) keys.current.toggle();
      else keys.current.start();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || typingHere(e.target)) return;
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

  const look: Look = mic.phase !== "idle" ? "listening" : thinking ? "thinking" : "ready";
  const elapsed = mic.phase === "on" ? Math.max(0, Math.floor((now - mic.since) / 1000)) : 0;
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  const action = teaching
    ? look === "listening" ? "Tap when you're done" : "Tap to start teaching"
    : look === "listening" ? "Listening…" : "Hold to talk";
  const diamond = (
    <Diamond band={band} look={look} teaching={teaching} action={action} label={look === "thinking" ? "Kite is thinking…" : action}
      clock={teaching && look === "listening" ? clock : undefined} start={start} stop={stop} toggle={toggle} />
  );
  const typeToggle = (
    <button type="button" className={s.typeToggle} data-on={typing} onClick={() => chooseTyping(!typing)}>
      <Glyph name={typing ? "mic" : "keyboard"} size={20} />
      {typing ? "Talk instead" : "Type instead"}
    </button>
  );

  return (
    <div className={s.dock} data-device={device}>
      {photo && (
        <div className={s.photo}>
          <img src={photo} alt="Your photo, sent with your next question" />
          <span>{typing ? "Kite will look at this" : "Hold the diamond and ask about it"}</span>
          <button type="button" className={s.iconButton} onClick={onClearPhoto} aria-label="Remove the photo">
            <Glyph name="close" size={18} />
          </button>
        </div>
      )}
      {typing && (
        <form
          className={s.typeBox}
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <textarea
            ref={box}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={teaching ? "Type what you know" : "Type a question"}
            aria-label={teaching ? "Type what you know" : "Type a question for Kite"}
          />
          <button type="submit" className={s.send} disabled={!text.trim() && !photo}>
            Send
          </button>
        </form>
      )}
      {device === "os" ? (
        <div className={s.voiceRow}>
          {teachButton}
          {diamond}
          {typeToggle}
        </div>
      ) : (
        <>
          <div className={s.voiceRow}>
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
          <div className={s.toggleRow}>{typeToggle}</div>
        </>
      )}
    </div>
  );
}

function Diamond({ band, look, teaching, action, label, clock, start, stop, toggle }: {
  band: Band; look: Look; teaching: boolean; action: string; label: string; clock?: string;
  start: () => void; stop: () => void; toggle: () => void;
}) {
  const reduce = useReducedMotion();
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
  const grown = look === "listening" && !reduce;
  return (
    <div className={s.talk}>
      <button
        type="button"
        className={s.diamond}
        data-look={look}
        aria-pressed={look === "listening"}
        aria-label={action}
        onContextMenu={(e) => e.preventDefault()}
        {...hold}
      >
        {/* The kite's diamond swells while it listens, with the band's spring: bouncy for little kids, none for teens. */}
        <motion.span
          className={s.diamondShape}
          initial={false}
          animate={{ transform: grown ? "rotate(45deg) scale(1.12)" : "rotate(45deg) scale(1)" }}
          transition={SPRING[band]}
        />
        {clock ? (
          <span className={s.clock}>{clock}</span>
        ) : look === "thinking" ? (
          <span className={s.dots} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        ) : (
          <Glyph name="mic" size={30} />
        )}
      </button>
      <span className={s.talkLabel} aria-hidden="true">
        {label}
      </span>
    </div>
  );
}
