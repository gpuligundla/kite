"use client";

import { useEffect, useRef, useState } from "react";
import { Answers } from "./Answers";
import type { StageProps } from "./CreationCard";
import styles from "./creations.module.css";

// The studio agent draws a brand-new game at 800 x 600 and a movie's special version at 1280 x 720.
// ponytail: fixed sizes; read them from the creation if the agent ever varies them.
const SIZE = { game: { w: 800, h: 600 }, movie: { w: 1280, h: 720 } };

/**
 * A page Claude Code wrote, run in a sandbox with scripts only and scaled to fit the card. A movie waits for the
 * kid's press before it loads, so its sound may autoplay. The page reports `kite.finish` through postMessage.
 */
export function SandboxFrame({ brain, data, celebrate }: StageProps) {
  const movie = data.kind === "movie";
  const size = SIZE[data.kind];
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(0);
  const [started, setStarted] = useState(!movie);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    const el = box.current!;
    const fit = new ResizeObserver(() => setScale(el.clientWidth / size.w));
    fit.observe(el);
    return () => fit.disconnect();
  }, [size.w]);

  useEffect(() => {
    // The page is untrusted: only its own window counts, and only the first finish celebrates.
    let seen = false;
    const onMessage = (e: MessageEvent) => {
      if (seen || e.source !== frame.current?.contentWindow || e.data?.type !== "kite.finish") return;
      seen = true;
      setFinished(true);
      if (!movie) celebrate();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [celebrate, movie]);

  const check = data.storyboard?.check;
  return (
    <>
      <div ref={box} className={styles.frameBox} style={{ aspectRatio: `${size.w} / ${size.h}` }}>
        {started ? (
          <iframe
            ref={frame}
            className={styles.frame}
            sandbox="allow-scripts"
            allow="autoplay *"
            src={data.html_url!}
            title={movie ? "Kite's special version of your movie" : "Your brand-new game"}
            width={size.w}
            height={size.h}
            style={{ transform: `scale(${scale})` }}
          />
        ) : (
          <button type="button" className={styles.poster} onClick={() => setStarted(true)} aria-label="Play the movie">
            <span className={styles.play} aria-hidden />
          </button>
        )}
      </div>
      {movie && check && finished && <Answers brain={brain} id={data.id} check={check} celebrate={celebrate} />}
    </>
  );
}
