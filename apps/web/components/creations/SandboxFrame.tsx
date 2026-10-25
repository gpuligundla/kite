"use client";

import { useEffect, useRef, useState } from "react";
import type { StageProps } from "./CreationCard";
import styles from "./creations.module.css";

/**
 * A page Claude Code wrote, run in a sandbox with scripts only. The frame is exactly the size it shows at and the
 * page fits itself to it, so nothing is scaled twice. A movie waits for the kid's press before it loads, so its sound
 * may autoplay. The page talks through postMessage: `kite.finish` (a game), `kite.ended` (a movie), `kite.escape`.
 */
export function SandboxFrame({ data, celebrate, take, onEnd, onEscape, overlay }: StageProps) {
  const movie = data.kind === "movie";
  const frame = useRef<HTMLIFrameElement>(null);
  const [pressed, setPressed] = useState(!movie);
  const started = pressed || take > 0;

  useEffect(() => {
    // The page is untrusted: only its own window counts, and only the first finish of each play celebrates.
    let finished = false;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const type = e.data?.type;
      if (type === "kite.escape") onEscape();
      else if (type === "kite.ended" && movie) onEnd();
      else if (type === "kite.finish" && !movie && !finished) {
        finished = true;
        celebrate();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [celebrate, movie, onEnd, onEscape, take]);

  return (
    <div className={styles.frameBox} data-kind={data.kind}>
      {started ? (
        <iframe
          key={take}
          ref={frame}
          className={styles.frame}
          sandbox="allow-scripts"
          allow="autoplay *"
          src={data.html_url!}
          title={movie ? "Kite's special version of your movie" : "Your brand-new game"}
        />
      ) : (
        <button type="button" className={styles.poster} onClick={() => setPressed(true)} aria-label="Play the movie">
          <span className={styles.play} aria-hidden />
        </button>
      )}
      {overlay}
    </div>
  );
}
