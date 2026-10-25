"use client";

import { useEffect, useState, type ReactNode } from "react";
import { KiteMark } from "@/components/kit/KiteMark";
import type { CreationEntry } from "@/lib/creations";
import styles from "./creations.module.css";

type Job = "movie" | "game" | "brandNew";

const COPY: Record<Job, { title: string; wait: string; driftSeconds: number }> = {
  movie: { title: "Kite is making your movie", wait: "It takes about 15 seconds.", driftSeconds: 8 },
  game: { title: "Kite is making your game", wait: "It takes about 20 seconds.", driftSeconds: 10 },
  brandNew: {
    title: "Kite is building a brand-new game",
    wait: "This one takes a few minutes. You can keep talking to Kite while you wait.",
    driftSeconds: 60,
  },
};
const BUILD_STEPS = [
  "Dreaming up the game",
  "Drawing the pieces",
  "Writing the rules",
  "Building the first level",
  "Playing it to test it",
  "Fixing the tricky bits",
  "Making it fun",
  "Almost ready",
];

function phrase(making: Job, step: number, total: number): string {
  if (making === "brandNew") return BUILD_STEPS[Math.min(step, BUILD_STEPS.length - 1)];
  if (making === "game") return "Picking the pieces";
  // A movie's step 0 is the storyboard, then one step per narrated line.
  return step === 0 ? "Writing the story" : step < total ? "Recording the voices" : "Putting it all together";
}

/** The kite climbs as the steps complete. Between steps it drifts up on its own, so a long wait never looks stuck. */
export function Making({ kind, progress }: { kind: CreationEntry["kind"]; progress?: CreationEntry["progress"] }) {
  const step = progress?.step ?? 0;
  const total = progress?.total ?? 1;
  // ponytail: a template game always reports 1 step, a brand-new one reports the studio agent's 8.
  const making: Job = kind === "movie" ? "movie" : total > 1 ? "brandNew" : "game";
  const copy = COPY[making];
  const elapsed = useSeconds();
  const drift = 0.8 * (1 - Math.exp(-elapsed / copy.driftSeconds));
  const height = Math.min(1, Math.max(0.04, step / total, drift));
  const now = phrase(making, step, total);

  return (
    <div className={styles.stage}>
      <h3 className={styles.title}>{copy.title}</h3>
      <Sky height={height} flying />
      <div className={styles.makingText} role="status">
        <p key={now} className={styles.phrase}>
          {now}
        </p>
        <p className={styles.sub}>{copy.wait}</p>
      </div>
    </div>
  );
}

/** A finished card with nothing to play: the kite rests on the ground. */
export function Resting({ title, lines, children }: { title: string; lines: string[]; children?: ReactNode }) {
  return (
    <div className={styles.stage}>
      <h3 className={styles.title}>{title}</h3>
      <Sky height={0} />
      <div className={styles.makingText}>
        {lines.map((l) => (
          <p key={l}>{l}</p>
        ))}
        {children}
      </div>
    </div>
  );
}

/** A strip of sky where the player will appear. The kite climbs up and away as `height` goes from 0 to 1. */
function Sky({ height, flying = false }: { height: number; flying?: boolean }) {
  return (
    <div className={styles.sky} aria-hidden>
      <div className={styles.track}>
        <div className={styles.climber} style={{ transform: `translate(${(height * 45).toFixed(2)}%, ${(-height * 100).toFixed(2)}%)` }}>
          <div className={styles.kite} data-flying={flying}>
            <span className={styles.string} />
            <KiteMark size={48} speaking={flying} label="" />
          </div>
        </div>
      </div>
    </div>
  );
}

function useSeconds(): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const tick = setInterval(() => setSeconds((Date.now() - start) / 1000), 1000);
    return () => clearInterval(tick);
  }, []);
  return seconds;
}
