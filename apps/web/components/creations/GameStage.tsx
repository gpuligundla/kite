"use client";

import { mountGame, type GameResult } from "@kite/games";
import { useEffect, useRef, useState } from "react";
import type { StageProps } from "./CreationCard";
import styles from "./creations.module.css";

type Ask = "idle" | "asking" | "asked" | "failed";

/** A template game on a KAPLAY canvas, with the way to ask Kite for a brand-new one under it. */
export default function GameStage({ brain, data, celebrate }: StageProps) {
  const spec = data.game!;
  const box = useRef<HTMLDivElement>(null);
  const [round, setRound] = useState(0);
  const [finished, setFinished] = useState(false);
  const [ask, setAsk] = useState<Ask>("idle");
  const latest = useRef({ brain, celebrate });
  latest.current = { brain, celebrate };

  useEffect(() => {
    // A fresh canvas per mount: KAPLAY can't boot twice on one, and dev mode mounts effects twice.
    const canvas = document.createElement("canvas");
    canvas.width = 960;
    canvas.height = 600;
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", spec.title);
    box.current!.append(canvas);
    const onFinish = (r: GameResult) => {
      setFinished(true);
      latest.current.celebrate();
      latest.current.brain.post(`/creations/${data.id}/result`, r).catch(() => {}); // learning evidence only; the kid's game is done either way
    };
    const stop = mountGame(canvas, spec, onFinish, data.sprites);
    return () => {
      stop();
      canvas.remove();
    };
  }, [data, spec, round]);

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
        {finished && (
          <button
            type="button"
            className={styles.action}
            onClick={() => {
              setFinished(false);
              setRound((n) => n + 1);
            }}
          >
            Play again
          </button>
        )}
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
