"use client";

import type { Brain } from "@kite/client";
import type { Creation } from "@kite/movie";
import { MotionConfig, motion } from "motion/react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { SPRING, type Band } from "@/lib/band";
import type { CreationEntry } from "@/lib/creations";
import { playSound } from "@/lib/sound";
import { Making, Resting } from "./Making";
import { SandboxFrame } from "./SandboxFrame";
import styles from "./creations.module.css";

export interface CreationCardProps {
  brain: Brain;
  creation: CreationEntry;
}

/** GET /creations/{id}: the creation plus slug-to-SVG sprites, passed to the players as they are. */
export type Loaded = Creation & { sprites: Record<string, string> };
export interface StageProps {
  brain: Brain;
  data: Loaded;
  celebrate: () => void;
}

// Remotion and KAPLAY touch the browser at import.
const MovieStage = dynamic(() => import("./MovieStage"), { ssr: false, loading: () => <div className={styles.moviePlaceholder} /> });
const GameStage = dynamic(() => import("./GameStage"), { ssr: false, loading: () => <div className={styles.gamePlaceholder} /> });

/** What the card shows. The fetched payload decides, not the status: a fallback can be a playable movie or game. */
type Stage =
  | { show: "making" }
  | { show: "frame" | "movie" | "game"; data: Loaded }
  | { show: "later"; kind: Creation["kind"] }
  | { show: "error" };

function stageOf(creation: CreationEntry, data: Loaded | "error" | undefined): Stage {
  if (creation.status === "making" || data === undefined) return { show: "making" };
  if (data === "error") return { show: "error" };
  if (data.html_url) return { show: "frame", data };
  if (data.storyboard) return { show: "movie", data };
  if (data.game) return { show: "game", data };
  return { show: "later", kind: data.kind };
}

// The stream replays recent events on connect, so an old creation flips from making to ready in a burst.
// ponytail: only a creation watched while it was made for this long gets the ready sound and the pop.
const WATCHED_MS = 1500;

/** One movie or game on the kid's screen: a climbing kite while it's made, then the player. */
export function CreationCard({ brain, creation }: CreationCardProps) {
  const root = useRef<HTMLElement>(null);
  const band = useBand(root);
  const [data, setData] = useState<Loaded | "error">();
  const [burst, setBurst] = useState(0);
  const [fresh, setFresh] = useState(false);
  const makingSince = useRef<number | null>(null);
  const stage = stageOf(creation, data);
  const ready = creation.status !== "making";

  useEffect(() => {
    if (!ready || data !== undefined) return;
    let live = true;
    brain.get<Loaded>(`/creations/${creation.id}`).then(
      (d) => live && setData(d),
      () => live && setData("error"),
    );
    return () => {
      live = false;
    };
  }, [brain, creation.id, ready, data]);

  // Decided when the status flips, while the fetch is still out, so the player mounts already knowing to pop.
  useEffect(() => {
    if (!ready) {
      makingSince.current ??= Date.now();
      return;
    }
    if (makingSince.current !== null && Date.now() - makingSince.current > WATCHED_MS) setFresh(true);
    makingSince.current = null;
  }, [ready]);

  const playable = stage.show === "movie" || stage.show === "game" || stage.show === "frame";
  useEffect(() => {
    if (fresh && playable) playSound("ready");
  }, [fresh, playable]);

  const celebrate = useCallback(() => {
    playSound("cheer");
    setBurst((n) => n + 1);
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <article ref={root} className={styles.card} data-creation={creation.id} data-stage={stage.show}>
        {stage.show === "making" ? (
          <Making kind={creation.kind} progress={ready ? done(creation.progress) : creation.progress} />
        ) : (
          <motion.div
            key={stage.show}
            className={styles.stage}
            initial={fresh && playable ? { opacity: 0, transform: "scale(0.96)" } : false}
            animate={{ opacity: 1, transform: "scale(1)" }}
            transition={SPRING[band]}
          >
            <StageView stage={stage} brain={brain} celebrate={celebrate} retry={() => setData(undefined)} />
          </motion.div>
        )}
        {burst > 0 && <Burst key={burst} />}
      </article>
    </MotionConfig>
  );
}

/** While a ready creation loads, the kite waits at the top of its sky. */
const done = (p: CreationEntry["progress"]) => ({ step: p?.total ?? 1, total: p?.total ?? 1 });

function StageView({ stage, brain, celebrate, retry }: { stage: Exclude<Stage, { show: "making" }>; brain: Brain; celebrate: () => void; retry: () => void }) {
  switch (stage.show) {
    case "movie":
      return (
        <>
          <h3 className={styles.title}>{stage.data.storyboard!.title}</h3>
          <MovieStage brain={brain} data={stage.data} celebrate={celebrate} />
        </>
      );
    case "game":
      return (
        <>
          <h3 className={styles.title}>{stage.data.game!.title}</h3>
          <GameStage brain={brain} data={stage.data} celebrate={celebrate} />
        </>
      );
    case "frame": {
      const movie = stage.data.kind === "movie";
      return (
        <>
          <header className={styles.heading}>
            <h3 className={styles.title}>{movie ? (stage.data.storyboard?.title ?? "Your movie") : "Your brand-new game"}</h3>
            <p className={styles.sub}>{movie ? "Kite's special version" : "Kite built this one just for you."}</p>
          </header>
          <SandboxFrame brain={brain} data={stage.data} celebrate={celebrate} />
        </>
      );
    }
    case "later":
      // A movie with nothing to play is a director's cut that didn't finish; its template movie is already on
      // screen, so the card just goes away. (A template movie that fails still plays the cached fallback.)
      if (stage.kind === "movie") return null;
      return (
        <Resting
          title={`Kite couldn't finish this ${stage.kind}`}
          lines={["It'll try again another time.", stage.kind === "game" ? "Your other game is still here to play." : "Ask Kite for a movie any time."]}
        />
      );
    case "error":
      return (
        <Resting title="Kite couldn't open this one" lines={["Check the connection, then try again."]}>
          <button type="button" className={styles.action} onClick={retry}>
            Try again
          </button>
        </Resting>
      );
  }
}

/** The data-band of the nearest kid page root, kept current when the grade slider moves it. */
function useBand(ref: RefObject<HTMLElement | null>): Band {
  const [band, setBand] = useState<Band>("g35");
  useEffect(() => {
    const host = ref.current?.closest<HTMLElement>("[data-band]");
    if (!host) return;
    const read = () => setBand((host.dataset.band as Band | undefined) ?? "g35");
    read();
    const watch = new MutationObserver(read);
    watch.observe(host, { attributes: true, attributeFilter: ["data-band"] });
    return () => watch.disconnect();
  }, [ref]);
  return band;
}

const RIPSTOP = ["var(--kite-red)", "var(--kite-yellow)", "var(--tail-teal)", "var(--sky-deep)"];

/** Ripstop diamonds flying out of the card: the cheer moments only. CSS sizes it per band and hides it for teens. */
function Burst() {
  return (
    <div className={styles.burst} aria-hidden>
      {Array.from({ length: 12 }, (_, i) => (
        <i key={i} style={{ "--turn": `${i / 12 + (i % 2) * 0.02}turn`, "--reach": i % 2 ? 0.7 : 1, background: RIPSTOP[i % 4] } as CSSProperties} />
      ))}
    </div>
  );
}
