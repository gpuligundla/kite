"use client";

import type { Brain } from "@kite/client";
import { useRef, useState } from "react";
import { playSound } from "@/lib/sound";
import s from "./os.module.css";

const HOLD_MS = 2000;
// ponytail: the brain's Sos body requires numbers, so 0,0 stands for "location unknown". Send null once it accepts one.
const UNKNOWN = { lat: 0, lng: 0 };

type Sos = "idle" | "holding" | "sending" | "sent" | "failed";

function whereAmI(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(UNKNOWN);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(UNKNOWN),
      { timeout: 5000, maximumAge: 60_000 },
    );
  });
}

/** A 2-second hold sends the kid's location to their grown-ups. Letting go early sends nothing. */
export function SosButton({ brain }: { brain: Brain }) {
  const [state, setState] = useState<Sos>("idle");
  const [located, setLocated] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const fire = async () => {
    setState("sending");
    try {
      const at = await whereAmI();
      await brain.sos(at);
      setLocated(at !== UNKNOWN);
      playSound("sent");
      setState("sent");
    } catch {
      playSound("oops");
      setState("failed");
    }
  };
  const begin = () => {
    if (state === "sending" || state === "holding") return;
    setState("holding");
    timer.current = setTimeout(() => void fire(), HOLD_MS);
  };
  const cancel = () => {
    clearTimeout(timer.current);
    setState((now) => (now === "holding" ? "idle" : now));
  };

  return (
    <>
      <div className={s.sosWrap}>
        <button
          type="button"
          className={s.sos}
          data-holding={state === "holding"}
          aria-label="SOS. Hold for 2 seconds to tell your grown-ups where you are."
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            begin();
          }}
          onPointerUp={cancel}
          onPointerCancel={cancel}
          onKeyDown={(e) => e.key === "Enter" && !e.repeat && begin()}
          onKeyUp={(e) => e.key === "Enter" && cancel()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <span className={s.sosText}>SOS</span>
          {/* A white copy on red, revealed left to right, so the label stays readable as the fill passes under it. */}
          <span className={s.sosFill} aria-hidden="true">
            SOS
          </span>
        </button>
        <span className={s.sosHint}>{state === "holding" ? "Keep holding" : state === "sending" ? "Sending" : "Hold 2 seconds"}</span>
      </div>
      {(state === "sent" || state === "failed") && (
        <div className={s.sosDone} role="alertdialog" aria-labelledby="sos-title">
          {state === "sent" ? (
            <>
              <span className={s.sosCheck} aria-hidden="true">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </span>
              <h2 id="sos-title">Your grown-ups got your SOS.</h2>
              <p>{located ? "They can see where you are." : "Kite couldn't find where you are, so tell them when they call."}</p>
            </>
          ) : (
            <>
              <h2 id="sos-title">SOS didn&apos;t send.</h2>
              <p>Hold the SOS button again, or ask a grown-up near you for help.</p>
            </>
          )}
          <p className={s.sos911}>SOS tells your grown-ups. For emergencies, call 911.</p>
          <button type="button" className={s.quiet} onClick={() => setState("idle")}>
            OK
          </button>
        </div>
      )}
    </>
  );
}
