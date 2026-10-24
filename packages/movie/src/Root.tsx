import React from "react";
import { Composition, registerRoot } from "remotion";
import { KiteMovie, type KiteMovieProps } from "./KiteMovie";
import { buildTimeline, MOVIE_FPS, MOVIE_HEIGHT, MOVIE_WIDTH } from "./timeline";

// The renderer's entry point. The web app uses KiteMovie directly through @remotion/player.
const Root: React.FC = () => (
  <Composition
    id="KiteMovie"
    component={KiteMovie}
    width={MOVIE_WIDTH}
    height={MOVIE_HEIGHT}
    fps={MOVIE_FPS}
    durationInFrames={1}
    defaultProps={{} as KiteMovieProps}
    calculateMetadata={({ props }) => ({ durationInFrames: buildTimeline(props.creation).durationInFrames })}
  />
);

registerRoot(Root);
