"use client";

import { mountGame, type GameResult } from "@kite/games";
import { useEffect, useRef, useState } from "react";
import type { StageProps } from "./CreationCard";
import styles from "./creations.module.css";

type Ask = "idle" | "asking" | "asked" | "failed";

/** A template game on a KAPLAY canvas, with the way to ask Kite for a brand-new one under it. */
export default function GameStage({ brain, data, celebrate, take }: StageProps) {
  const spec = data.game!;
  const box = useRef<HTMLDivElement>(null);
  const [ask, setAsk] = useState<Ask>("idle");
  const latest = useRef({ brain, celebrate });
  latest.current = { brain, celebrate };

  useEffect(() => {
    // A fresh canvas per mount and per "Play again": KAPLAY can't boot twice on one, and dev mode mounts effects twice.
    // KAPLAY sizes it to the box at the screen's pixel density.
    const el = box.current!;
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-label", spec.title);
    el.append(canvas);
    // KAPLAY keeps Tab for itself; let Tab move focus out of the game instead.
    const tab = (e: KeyboardEvent) => e.key === "Tab" && e.stopPropagation();
    el.addEventListener("keydown", tab, true);
    const onFinish = (r: GameResult) => {
      latest.current.celebrate();
      latest.current.brain.post(`/creations/${data.id}/result`, r).catch(() => {}); // learning evidence only; the kid's game is done either way
    };
    const stop = mountGame(canvas, spec, onFinish, data.sprites);
    return () => {
      stop();
      canvas.remove();
      el.removeEventListener("keydown", tab, true);
    };
  }, [data, spec, take]);

  async function buildNew() {
    setAsk("asking");
    try {
      await brain.makeGame(spec.title.slice(0, 200), spec.instructions.slice(0, 300));
      setAsk("asked");
    } catch {
      setAsk("failed");
    }
  }

  return (
    <>
      <div ref={box} className={styles.gameBox} />
      <div className={styles.actions}>
        {ask === "asked" ? (
          <p className={styles.sub} role="status">
            Kite is building it. Your brand-new game will show up here when it's ready.
          </p>
        ) : (
          <button type="button" className={`${styles.action} ${styles.actionWarm}`} disabled={ask === "asking"} onClick={buildNew}>
            Build me a brand-new one!
          </button>
        )}
        {ask === "failed" && (
          <p className={styles.sub} role="status">
            Kite couldn't start a new game. Try again in a minute.
          </p>
        )}
      </div>
    </>
  );
}
