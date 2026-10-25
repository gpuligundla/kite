"use client";

import { KiteMovie, MOVIE_FPS, MOVIE_HEIGHT, MOVIE_WIDTH, buildTimeline } from "@kite/movie";
import { Player, type PlayerRef } from "@remotion/player";
import { useEffect, useMemo, useRef } from "react";
import type { StageProps } from "./CreationCard";
import styles from "./creations.module.css";

/** A storyboard movie in the Remotion player. It stops where the check question starts and tells the card. */
export default function MovieStage({ data, take, onEnd, overlay }: StageProps) {
  const inputProps = useMemo(() => {
    const { sprites, ...creation } = data;
    return { creation, sprites };
  }, [data]);
  const timeline = useMemo(() => buildTimeline(inputProps.creation), [inputProps]);
  const player = useRef<PlayerRef>(null);

  useEffect(() => {
    const p = player.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => {
      if (e.detail.frame < timeline.checkFrom) return;
      p.pause();
      onEnd();
    };
    p.addEventListener("frameupdate", onFrame);
    p.addEventListener("ended", onEnd);
    return () => {
      p.removeEventListener("frameupdate", onFrame);
      p.removeEventListener("ended", onEnd);
    };
  }, [timeline, onEnd]);

  useEffect(() => {
    if (take === 0) return;
    player.current?.seekTo(0);
    player.current?.play();
  }, [take]);

  return (
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
        // The card owns full screen, so every movie and game goes full screen the same way.
        allowFullscreen={false}
        moveToBeginningWhenEnded={false}
        renderPoster={() => <PlayPoster />}
        showPosterWhenUnplayed
        className={styles.movie}
      />
      {overlay}
    </div>
  );
}

function PlayPoster() {
  return (
    <div className={styles.poster}>
      <span className={styles.play} aria-hidden />
    </div>
  );
}
