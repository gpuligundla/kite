"use client";

import type { Brain } from "@kite/client";
import type { Creation } from "@kite/movie";
import { MotionConfig, motion } from "motion/react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { SPRING, type Band } from "@/lib/band";
import type { CreationEntry } from "@/lib/creations";
import { playSound } from "@/lib/sound";
import { CheckCard, type Answer } from "./Check";
import { Making, Resting } from "./Making";
import { SandboxFrame } from "./SandboxFrame";
import { StoryPlayer } from "@/components/story/StoryPlayer";
import styles from "./creations.module.css";

export interface CreationCardProps {
  brain: Brain;
  creation: CreationEntry;
}

/** GET /creations/{id}: the creation plus slug-to-SVG sprites, passed to the players as they are. */
export type Loaded = Creation & { sprites: Record<string, string> };
/** What the card hands every player. */
export interface StageProps {
  brain: Brain;
  data: Loaded;
  /** A finished game cheers, with the burst. */
  celebrate: () => void;
  /** Goes up by one each "Play again": the player starts over from the top. */
  take: number;
  /** A movie reached its end, so the card lays its check question over it. */
  onEnd: () => void;
  /** Esc pressed inside a page, where the card can't hear it: leave full screen. */
  onEscape: () => void;
  /** Drawn over the picture, inside the player's box. */
  overlay: ReactNode;
}

// Remotion and KAPLAY touch the browser at import.
const MovieStage = dynamic(() => import("./MovieStage"), { ssr: false, loading: () => <div className={styles.moviePlaceholder} /> });
const GameStage = dynamic(() => import("./GameStage"), { ssr: false, loading: () => <div className={styles.gamePlaceholder} /> });

/** What the card shows. The fetched payload decides, not the status: a fallback can be a playable movie or game. */
type Stage =
  | { show: "making" }
  | { show: "frame" | "movie" | "game"; data: Loaded }
  | { show: "story"; data: Loaded }
  | { show: "later"; kind: Creation["kind"] }
  | { show: "error" };
type Playing = Extract<Stage, { show: "frame" | "movie" | "game" }>;

function stageOf(creation: CreationEntry, data: Loaded | "error" | undefined): Stage {
  if (creation.status === "making" || data === undefined) return { show: "making" };
  if (data === "error") return { show: "error" };
  // A storybook brings its own page controls, full screen and question, so it skips the movie and game dialog.
  if (data.kind === "story") return { show: "story", data };
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

  const playable = "data" in stage;
  useEffect(() => {
    if (fresh && playable) playSound("ready");
  }, [fresh, playable]);

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
            {stage.show === "story" ? (
              <StoryPlayer brain={brain} creation={creation} data={stage.data} />
            ) : "data" in stage ? (
              <Player stage={stage} brain={brain} />
            ) : (
              <NothingToPlay stage={stage} retry={() => setData(undefined)} />
            )}
          </motion.div>
        )}
      </article>
    </MotionConfig>
  );
}

/** While a ready creation loads, the kite waits at the top of its sky. */
const done = (p: CreationEntry["progress"]) => ({ step: p?.total ?? 1, total: p?.total ?? 1 });

/** In the card, full screen over the whole page, or closed down to its title. */
type View = "card" | "full" | "closed";

function heading(stage: Playing): { title: string; sub?: string } {
  const { data } = stage;
  if (stage.show === "movie") return { title: data.storyboard!.title };
  if (stage.show === "game") return { title: data.game!.title };
  return data.kind === "movie"
    ? { title: data.storyboard?.title ?? "Your movie", sub: "Kite's special version" }
    : { title: "Your brand-new game", sub: "Kite built this one just for you." };
}

/**
 * The same controls on every movie and game, whatever made it: full screen, play again, close. The player sits in a
 * <dialog> that never moves in the page, so a game or movie keeps running as it goes full screen and back; showModal()
 * lifts it above the page, makes the rest inert, and Esc brings it back.
 */
function Player({ stage, brain }: { stage: Playing; brain: Brain }) {
  const { data } = stage;
  const movie = data.kind === "movie";
  const check = movie ? data.storyboard?.check : undefined;
  const { title, sub } = heading(stage);
  const shell = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState<View>("card");
  const [take, setTake] = useState(0);
  const [atEnd, setAtEnd] = useState(false);
  const [answer, setAnswer] = useState<Answer>({});
  const [burst, setBurst] = useState(0);

  const celebrate = useCallback(() => {
    playSound("cheer");
    setBurst((n) => n + 1);
  }, []);
  const onEnd = useCallback(() => setAtEnd(true), []);
  const onEscape = useCallback(() => setView((v) => (v === "full" ? "card" : v)), []);
  const again = () => {
    setAtEnd(false);
    setTake((n) => n + 1);
  };
  const close = () => setView(view === "full" ? "card" : "closed");

  useLayoutEffect(() => {
    const d = shell.current;
    if (!d || (view === "full") === d.matches(":modal")) return;
    d.close();
    if (view === "full") {
      d.showModal();
      // The game takes the keys straight away; a movie leaves focus on the dialog.
      (d.querySelector<HTMLElement>("iframe, canvas") ?? d).focus();
    } else {
      // ponytail: the open attribute shows it in place again; show() would also move focus into it.
      d.setAttribute("open", "");
    }
  }, [view]);

  if (view === "closed")
    return (
      <header className={styles.bar}>
        <h3 className={styles.title}>{title}</h3>
        <Control icon="open" onClick={() => setView("card")}>
          Open
        </Control>
      </header>
    );

  const props: StageProps = {
    brain,
    data,
    celebrate,
    take,
    onEnd,
    onEscape,
    overlay:
      check && atEnd ? (
        <CheckCard brain={brain} id={data.id} check={check} voice={data.audio.check} answer={answer} setAnswer={setAnswer} celebrate={celebrate} again={again} close={close} />
      ) : null,
  };
  return (
    <dialog
      ref={shell}
      open
      tabIndex={-1}
      className={styles.shell}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        setView("card");
      }}
    >
      <header className={styles.bar}>
        <div className={styles.heading}>
          <h3 className={styles.title}>{title}</h3>
          {sub && <p className={styles.sub}>{sub}</p>}
        </div>
        <div className={styles.controls}>
          <Control
            icon="full"
            hidden={view === "full"}
            onClick={() => {
              playSound("whoosh");
              setView("full");
            }}
          >
            Full screen
          </Control>
          <Control icon="again" onClick={again}>
            {movie ? "Watch again" : "Play again"}
          </Control>
          <Control icon="close" onClick={close}>
            Close
          </Control>
        </div>
      </header>
      {stage.show === "movie" ? <MovieStage {...props} /> : stage.show === "game" ? <GameStage {...props} /> : <SandboxFrame {...props} />}
      {check && !atEnd && !answer.reply && <p className={styles.sub}>Watch to the end. Kite has a question for you.</p>}
      {burst > 0 && <Burst key={burst} />}
    </dialog>
  );
}

const ICONS = {
  full: "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5",
  again: "M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5",
  close: "M6 6l12 12M18 6L6 18",
  open: "M6 9l6 6 6-6",
};

function Control({ icon, hidden, onClick, children }: { icon: keyof typeof ICONS; hidden?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={`${styles.action} ${styles.control}`} hidden={hidden} onClick={onClick}>
      <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
        <path d={ICONS[icon]} />
      </svg>
      {children}
    </button>
  );
}

function NothingToPlay({ stage, retry }: { stage: Extract<Stage, { show: "later" | "error" }>; retry: () => void }) {
  if (stage.show === "error")
    return (
      <Resting title="Kite couldn't open this one" lines={["Check the connection, then try again."]}>
        <button type="button" className={styles.action} onClick={retry}>
          Try again
        </button>
      </Resting>
    );
  // A movie with nothing to play is a director's cut that didn't finish; its template movie is already on
  // screen, so the card just goes away. (A template movie that fails still plays the cached fallback.)
  if (stage.kind === "movie") return null;
  return <Resting title={`Kite couldn't finish this ${stage.kind}`} lines={["It'll try again another time.", "Your other game is still here to play."]} />;
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

/** Ripstop diamonds flying out of the player: the cheer moments only. CSS sizes it per band and hides it for teens. */
function Burst() {
  return (
    <div className={styles.burst} aria-hidden>
      {Array.from({ length: 12 }, (_, i) => (
        <i key={i} style={{ "--turn": `${i / 12 + (i % 2) * 0.02}turn`, "--reach": i % 2 ? 0.7 : 1, background: RIPSTOP[i % 4] } as CSSProperties} />
      ))}
    </div>
  );
}
