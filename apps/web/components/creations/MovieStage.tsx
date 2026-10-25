"use client";

import { KiteMovie, MOVIE_FPS, MOVIE_HEIGHT, MOVIE_WIDTH, buildTimeline } from "@kite/movie";
import { Player, type PlayerRef } from "@remotion/player";
import { useEffect, useMemo, useRef, useState } from "react";
import { Answers } from "./Answers";
import type { StageProps } from "./CreationCard";
import styles from "./creations.module.css";

/** A storyboard movie in the Remotion player. The answer buttons appear once the check question is on screen. */
export default function MovieStage({ brain, data, celebrate }: StageProps) {
  const inputProps = useMemo(() => {
    const { sprites, ...creation } = data;
    return { creation, sprites };
  }, [data]);
  const timeline = useMemo(() => buildTimeline(inputProps.creation), [inputProps]);
  const player = useRef<PlayerRef>(null);
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    const p = player.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => {
      if (e.detail.frame >= timeline.checkFrom) setAsked(true);
    };
    const onEnded = () => setAsked(true);
    p.addEventListener("frameupdate", onFrame);
    p.addEventListener("ended", onEnded);
    return () => {
      p.removeEventListener("frameupdate", onFrame);
      p.removeEventListener("ended", onEnded);
    };
  }, [timeline]);

  return (
    <>
      <div className={styles.screen}>
        <Player
          ref={player}
          component={KiteMovie}
          inputProps={inputProps}
          durationInFrames={timeline.durationInFrames}
          fps={MOVIE_FPS}
          compositionWidth={MOVIE_WIDTH}
          compositionHeight={MOVIE_HEIGHT}
          controls
          clickToPlay
          // The check question is the last frame; it stays up instead of jumping back to the start.
          moveToBeginningWhenEnded={false}
          renderPoster={() => <PlayPoster />}
          showPosterWhenUnplayed
          style={{ width: "100%", display: "block" }}
        />
      </div>
      {asked ? (
        <Answers brain={brain} id={data.id} check={data.storyboard!.check} celebrate={celebrate} />
      ) : (
        <p className={styles.sub}>Watch to the end. Kite has a question for you.</p>
      )}
    </>
  );
}

function PlayPoster() {
  return (
    <div className={styles.poster}>
      <span className={styles.play} aria-hidden />
    </div>
  );
}
