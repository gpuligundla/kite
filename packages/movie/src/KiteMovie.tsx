import React from "react";
import { AbsoluteFill, Audio, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Background, GROUND_Y, H, W } from "./backgrounds";
import { resolveSprite } from "./sprites";
import { buildTimeline, type Creation, type Timeline, type TimelineScene } from "./timeline";
import type { components } from "../../client/src/contract";

type Scene = components["schemas"]["Scene"];
type Actor = components["schemas"]["Actor"];

export type KiteMovieProps = {
  creation: Creation;
  /** slug -> data: URL (or any image URL). Slugs not listed get a generated badge. */
  sprites?: Record<string, string>;
};

const SPRITE_SIZE = 230;
const CAMERA_TRAVEL = 140;
const CAMERA_ZOOM = 0.15;
const ENTRANCE_FRAMES = 20;
/** The music bed: the director's cut's level between lines, a light duck under a voice so the bed stays audible. */
const MUSIC_VOLUME = 0.16;
const MUSIC_UNDER_VOICE = 0.12;
const DUCK_FRAMES = 8;

/** Absolute and data URLs play as they are. Anything else is a file in the bundle's public dir. */
const audioSrc = (url: string) => (/^(https?:|data:|blob:|\/)/.test(url) ? url : staticFile(url));

const isSpeaking = (actor: Actor, speaker: string) =>
  [actor.name, actor.sprite].some((n) => n && n.toLowerCase() === speaker.toLowerCase());

const ActorView: React.FC<{ actor: Actor; x: number; speaking: boolean; src: string }> = ({ actor, x, speaking, src }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = Math.min(frame / ENTRANCE_FRAMES, 1);
  const t = frame / fps;

  let dx = 0;
  let dy = 0;
  let scale = 1;
  let rotate = 0;
  if (actor.entrance === "left") dx = -(1 - enter) * (x + SPRITE_SIZE);
  if (actor.entrance === "right") dx = (1 - enter) * (W - x + SPRITE_SIZE);
  if (actor.entrance === "pop") scale = spring({ frame, fps, config: { damping: 9 } });

  if (actor.motion === "bounce") dy -= Math.abs(Math.sin(t * 3)) * 28;
  if (actor.motion === "float") dy -= 60 + Math.sin(t * 2) * 18;
  if (actor.motion === "walk") {
    dx += Math.sin(t * 1.5) * 50;
    rotate = Math.sin(t * 6) * 4;
  }
  if (speaking) dy -= Math.abs(Math.sin(t * 9)) * 22;

  return (
    <div style={{ position: "absolute", left: x - SPRITE_SIZE / 2, top: GROUND_Y - SPRITE_SIZE, width: SPRITE_SIZE, textAlign: "center",
      transform: `translate(${dx}px, ${dy}px) rotate(${rotate}deg) scale(${scale})`, transformOrigin: "50% 100%" }}>
      <Img src={src} style={{ width: SPRITE_SIZE, height: SPRITE_SIZE }} />
      {actor.name && (
        <div style={{ fontFamily: "Arial, sans-serif", fontWeight: 700, fontSize: 30, color: "#fff", textShadow: "0 2px 6px #0008" }}>{actor.name}</div>
      )}
    </div>
  );
};

const Captions: React.FC<{ scene: TimelineScene; frame: number }> = ({ scene, frame }) => {
  const line = [...scene.lines].reverse().find((l) => frame >= l.from);
  if (!line) return null;
  const fontSize = line.words.length > 16 ? 38 : 46; // long lines stay at three rows, clear of the actors
  return (
    <div style={{ position: "absolute", left: 60, right: 60, bottom: 36, padding: "18px 28px", borderRadius: 24, background: "#000b",
      fontFamily: "Arial, sans-serif", fontWeight: 700, fontSize, lineHeight: 1.25, color: "#fff", textAlign: "center" }}>
      {line.words.map((w, i) => {
        const on = frame >= w.fromFrame && frame < w.toFrame;
        return (
          <span key={i} style={{ color: on ? "#ffd54f" : "#fff", display: "inline-block", transform: on ? "scale(1.12)" : "none", margin: "0 0.3em" }}>
            {w.text}
          </span>
        );
      })}
    </div>
  );
};

const SceneView: React.FC<{ scene: Scene; timed: TimelineScene; length: number; sprites?: Record<string, string> }> = ({ scene, timed, length, sprites }) => {
  const local = useCurrentFrame();
  const frame = local + timed.from;
  const progress = interpolate(local, [0, length], [0, 1], { extrapolateRight: "clamp" });
  const cx = scene.camera === "pan" ? (progress - 0.5) * CAMERA_TRAVEL * 2 : 0;
  const zoom = scene.camera === "zoom" ? 1 + progress * CAMERA_ZOOM : 1;
  const speaker = [...timed.lines].reverse().find((l) => frame >= l.from && frame < l.from + l.durationInFrames)?.speaker;
  const n = scene.actors.length;

  return (
    <AbsoluteFill>
      <Background bg={scene.background} palette={scene.palette} cx={cx} scale={zoom} />
      {scene.actors.map((a, i) => (
        <ActorView key={i} actor={a} x={((i + 1) * W) / (n + 1) - cx * 1.2} speaking={!!speaker && isSpeaking(a, speaker)} src={resolveSprite(a.sprite, sprites)} />
      ))}
      <Captions scene={timed} frame={frame} />
    </AbsoluteFill>
  );
};

/** Volume at an absolute frame: ducked under every line, easing back up in the gaps, fading out at the end. */
const musicVolume = (timeline: Timeline, fps: number) => {
  const lines = timeline.scenes.flatMap((s) => s.lines);
  return (frame: number) => {
    const away = Math.min(...lines.map((l) => Math.max(l.from - frame, frame - (l.from + l.durationInFrames), 0)));
    const level = interpolate(away, [0, DUCK_FRAMES], [MUSIC_UNDER_VOICE, MUSIC_VOLUME], { extrapolateRight: "clamp" });
    return level * interpolate(frame, [timeline.durationInFrames - fps, timeline.durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  };
};

export const KiteMovie: React.FC<KiteMovieProps> = ({ creation, sprites }) => {
  const { fps } = useVideoConfig();
  const timeline: Timeline = buildTimeline(creation, fps);
  const scenes = creation.storyboard!.scenes;
  const music = creation.audio.music;

  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {scenes.map((scene, i) => {
        const timed = timeline.scenes[i];
        const end = timeline.scenes[i + 1]?.from ?? timeline.durationInFrames;
        return (
          <Sequence key={i} from={timed.from} durationInFrames={end - timed.from}>
            <SceneView scene={scene} timed={timed} length={timed.durationInFrames} sprites={sprites} />
          </Sequence>
        );
      })}
      {timeline.scenes.flatMap((s) =>
        s.lines.map((l) => {
          const url = creation.audio[l.key];
          return url ? (
            <Sequence key={l.key} from={l.from} durationInFrames={l.durationInFrames + fps}>
              <Audio src={audioSrc(url)} />
            </Sequence>
          ) : null;
        }),
      )}
      {music && <Audio src={audioSrc(music)} loop volume={musicVolume(timeline, fps)} loopVolumeCurveBehavior="extend" />}
    </AbsoluteFill>
  );
};
