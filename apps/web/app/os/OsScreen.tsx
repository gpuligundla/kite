"use client";

import { BrainError, NO_TURN, type DeviceKind, type Grade, type Teachable, type TurnView } from "@kite/client";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { KiteMark } from "@/components/kit/KiteMark";
import { Burst } from "@/components/os/Burst";
import { Dock } from "@/components/os/Dock";
import { Glyph } from "@/components/os/Glyph";
import { shrinkPhoto, useVoice } from "@/components/os/media";
import { SosButton } from "@/components/os/SosButton";
import { TeachPicker } from "@/components/os/TeachPicker";
import { Thread } from "@/components/os/Thread";
import s from "@/components/os/os.module.css";
import { bandFor, type Band } from "@/lib/band";
import { KID_ID, useBrain, useBrainEvents, useTalk } from "@/lib/brain";
import { reduceCreations, type CreationKind, type Creations } from "@/lib/creations";
import { isMuted, playSound, setMuted, setSoundBand } from "@/lib/sound";

type Me = { name: string; grade: number };
type Teach = { step: "off" } | { step: "picking" } | { step: "on"; concept: Teachable };
type Photo = { blob: Blob; url: string };

const HELLO: Record<Band, (name: string) => [string, string]> = {
  k2: (n) => [`Hi ${n}!`, "Hold the red diamond and ask me anything."],
  g35: (n) => [`Hi ${n}!`, "What are you wondering about today?"],
  g68: (n) => [`Hey ${n}.`, "What's on your mind?"],
  g912: (n) => [`Hey ${n}`, "Ask me anything."],
};
const GRADE_NAME = (g: number) => (g === 0 ? "K" : String(g));
// A chip says what the kid would say, so the brain's own turn picks the topic and the goal from the conversation.
const MAKE_ASK: Record<CreationKind, string> = { movie: "Make that into a movie", game: "Make a game about that" };
// Allows for the brain's clock running a little ahead of this one.
const REPLAY_SLACK_MS = 3000;

export function OsScreen({ device }: { device: DeviceKind }) {
  const brain = useBrain(device);
  const talk = useTalk(brain);
  const reduce = useReducedMotion();
  const [me, setMe] = useState<Me | null>(null);
  const [blocked, setBlocked] = useState<"unpaired" | "offline" | null>(null);
  const [grade, setGrade] = useState(5);
  const [muted, setMutedState] = useState(false);
  const [teach, setTeach] = useState<Teach>({ step: "off" });
  const [opener, setOpener] = useState<string | null>(null);
  const [creations, setCreations] = useState<Creations>([]);
  const [anchors, setAnchors] = useState<Record<string, string>>({});
  const [making, setMaking] = useState<ReadonlySet<string>>(new Set());
  const [opened] = useState(() => Date.now());
  const [earlier, setEarlier] = useState<ReadonlySet<string>>(new Set());
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [party, setParty] = useState(0);
  const [cheering, setCheering] = useState(false);
  const started = useRef(new Set<string>());
  const celebrated = useRef(new Set<string>());
  const band = bandFor(grade);
  const { speaking, hush } = useVoice(brain, muted);

  useEffect(() => {
    brain.get<Me>(`/kids/${KID_ID}/me`).then(
      (m) => {
        setMe(m);
        setGrade(m.grade);
      },
      (err) => setBlocked(err instanceof BrainError && (err.status === 401 || err.status === 403) ? "unpaired" : "offline"),
    );
  }, [brain]);
  // Read after mount: the server render can't see this browser's setting.
  useEffect(() => setMutedState(isMuted()), []);

  useEffect(() => setSoundBand(band), [band]);

  useBrainEvents(brain, (e) => {
    const replayed = Date.parse(e.at) < opened - REPLAY_SLACK_MS;
    setCreations((list) => reduceCreations(list, e));
    // A creation shows under the turn that asked for it. One started elsewhere, live, shows under the latest turn.
    if (e.type === "creation.progress" || e.type === "creation.ready") {
      const turn = e.turn_id ?? (replayed ? undefined : brain.talk.getState().turns.at(-1)?.id);
      if (turn) setAnchors((a) => (a[e.creation_id] ? a : { ...a, [e.creation_id]: turn }));
    }
    // The Teach Kite opener is the only sentence with no turn. One this screen didn't start came from the kid asking
    // out loud here, so the screen follows into the lesson the brain began.
    if (e.type === "answer.sentence" && e.turn_id === null) {
      setOpener(e.text);
      const latest = brain.talk.getState().turns.filter((t) => t.id !== NO_TURN).at(-1);
      if (!replayed && teach.step === "off" && latest?.mine) followTeach();
    }
    // The stream replays recent events on connect, sometimes without a turn's `heard`. Who asked those turns is
    // unknown, so they get no device label.
    const talkEvent = e.type === "heard" || e.type === "answer.sentence" || e.type === "answer.done";
    if (talkEvent && replayed && e.turn_id) {
      const turn = e.turn_id;
      setEarlier((s) => (s.has(turn) ? s : new Set(s).add(turn)));
    }
  });

  // A whoosh as each of the kid's answers starts (quiet under Kite's voice). A finished teach-back is the kid's effort,
  // so it's celebrated whatever Kite says about it. No outcome is shown.
  useEffect(() => {
    for (const t of talk.turns) {
      if (!t.mine) continue;
      if (t.sentences.length > 0 && !started.current.has(t.id)) {
        started.current.add(t.id);
        playSound("whoosh");
      }
      if (t.done?.route === "teach" && !celebrated.current.has(t.id)) {
        celebrated.current.add(t.id);
        playSound("cheer");
        setParty((n) => n + 1);
        setCheering(true);
      }
    }
  }, [talk]);
  useEffect(() => {
    if (!cheering) return;
    const t = setTimeout(() => setCheering(false), 3200);
    return () => clearTimeout(t);
  }, [cheering, party]);

  const showProblem = useCallback((message: string) => {
    playSound("oops");
    setProblem(message);
  }, []);

  const clearPhoto = () =>
    setPhoto((p) => {
      if (p) URL.revokeObjectURL(p.url);
      return null;
    });

  const ask = async (utterance: { text: string } | { audio: Blob }) => {
    setProblem(null);
    const image = photo?.blob;
    clearPhoto();
    const lesson = teach.step === "on" ? { mode: "teach" as const, conceptId: teach.concept.concept_id } : {};
    try {
      await brain.say({ ...utterance, ...lesson, ...(image ? { image } : {}), asOfGrade: grade as Grade });
    } catch {
      showProblem("Kite didn't get that. Try sending it again.");
    }
  };

  const make = async (t: TurnView, kind: CreationKind) => {
    const key = `${t.id}:${kind}`;
    setMaking((m) => new Set(m).add(key));
    hush();
    setProblem(null);
    try {
      await brain.say({ text: MAKE_ASK[kind], asOfGrade: grade as Grade });
    } catch {
      setMaking((m) => {
        const next = new Set(m);
        next.delete(key);
        return next;
      });
      showProblem(`Kite couldn't start your ${kind}. Try again in a moment.`);
    }
  };

  const followTeach = () =>
    brain.get<Teachable | null>(`/kids/${KID_ID}/teach/active`).then(
      (concept) => concept && setTeach((t) => (t.step === "off" ? { step: "on", concept } : t)),
      () => showProblem("Kite couldn't start listening. Try Teach Kite again."),
    );

  const startTeaching = async (concept: Teachable) => {
    setTeach({ step: "on", concept });
    setOpener(null);
    setProblem(null);
    try {
      await brain.startTeach(concept.concept_id);
    } catch {
      setTeach({ step: "off" });
      showProblem("Kite couldn't start listening. Try Teach Kite again.");
    }
  };

  const openPicker = () => {
    playSound("whoosh");
    setTeach({ step: "picking" });
  };
  const closePicker = useCallback(() => setTeach((t) => (t.step === "picking" ? { step: "off" } : t)), []);

  if (blocked) {
    return (
      <main className={`kid ${s.unpaired}`} data-band="g35">
        <KiteMark size={96} />
        {blocked === "unpaired" ? (
          <>
            <h1>This screen isn&apos;t paired with Kite yet.</h1>
            <p>Open the setup link a grown-up made for this device, and Kite will be here.</p>
          </>
        ) : (
          <>
            <h1>Kite can&apos;t connect right now.</h1>
            <p>Check that this device is online, then reload the page.</p>
          </>
        )}
      </main>
    );
  }

  const [hello, nudge] = HELLO[band](me?.name ?? "there");
  const teaching = teach.step === "on";
  const thinking = talk.turns.some((t) => t.mine && t.id !== NO_TURN && !t.done && t.sentences.length === 0);
  const teachButton = teaching ? (
    <button type="button" className={s.teachButton} data-on="true" onClick={() => setTeach({ step: "off" })}>
      <Glyph name="close" size={20} />
      Stop teaching
    </button>
  ) : (
    <button type="button" className={s.teachButton} onClick={openPicker}>
      <Glyph name="teach" size={20} />
      Teach Kite
    </button>
  );

  return (
    <main className={`kid ${s.screen}`} data-band={band} data-device={device} data-ready={me !== null}>
      <header className={s.top}>
        <div className={s.cornerLeft}>
          <button
            type="button"
            className={s.iconButton}
            aria-pressed={muted}
            aria-label={muted ? "Turn sound on" : "Turn sound off"}
            onClick={() => {
              setMuted(!muted);
              setMutedState(!muted);
            }}
          >
            <Glyph name={muted ? "soundOff" : "soundOn"} />
          </button>
          <Link href="/os/remember" className={s.remember}>
            What Kite remembers
          </Link>
        </div>
        <div className={s.kiteSpot}>
          <motion.div
            key={party}
            className={s.kiteMark}
            animate={
              party && !reduce
                ? { transform: ["translateY(0px) rotate(0deg)", "translateY(-22px) rotate(-8deg)", "translateY(0px) rotate(4deg)", "translateY(0px) rotate(0deg)"] }
                : undefined
            }
            transition={{ duration: 0.9, ease: [0.77, 0, 0.175, 1] }}
          >
            <KiteMark size={150} speaking={speaking} label={speaking ? "Kite, talking" : "Kite"} />
          </motion.div>
          {cheering && !reduce && <Burst key={`burst-${party}`} />}
        </div>
        <h1 className={s.hello}>{me ? hello : " "}</h1>
        <AnimatePresence>
          {cheering && (
            <motion.p
              className={s.cheer}
              role="status"
              initial={{ opacity: 0, transform: reduce ? "none" : "translateY(6px) scale(0.96)" }}
              animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
            >
              Thanks for teaching me!
            </motion.p>
          )}
        </AnimatePresence>
        <div className={s.cornerRight}>
          {device === "handheld" ? (
            <SosButton brain={brain} />
          ) : (
            <label className={s.grade}>
              <span>Grade {GRADE_NAME(grade)}</span>
              <input
                type="range"
                min={0}
                max={12}
                step={1}
                value={grade}
                onChange={(e) => setGrade(Number(e.target.value))}
                aria-valuetext={`Grade ${GRADE_NAME(grade)}`}
              />
            </label>
          )}
        </div>
      </header>

      <Thread
        brain={brain}
        band={band}
        device={device}
        turns={talk.turns}
        earlier={earlier}
        creations={creations}
        anchors={anchors}
        making={making}
        onMake={(t, kind) => void make(t, kind)}
        empty={me && <p className={s.nudge}>{nudge}</p>}
      />

      <footer className={s.bottom}>
        <AnimatePresence>
          {teach.step === "on" && (
            <motion.div
              className={s.teachBar}
              initial={{ opacity: 0, transform: "translateY(8px)" }}
              animate={{ opacity: 1, transform: "translateY(0px)" }}
              exit={{ opacity: 0, transform: "translateY(8px)" }}
              transition={{ duration: 0.26, ease: [0.23, 1, 0.32, 1] }}
            >
              <span className={s.teachWhat}>You&apos;re teaching Kite</span>
              <strong>{teach.concept.kid_name}</strong>
              <span>{opener ?? "Kite is getting ready to listen."}</span>
            </motion.div>
          )}
        </AnimatePresence>
        {problem && (
          <p className={s.problem} role="alert">
            {problem}
          </p>
        )}
        <Dock
          device={device}
          band={band}
          teaching={teaching}
          thinking={thinking}
          onSend={(text) => void ask({ text })}
          onAudio={(audio) => void ask({ audio })}
          onListen={() => {
            hush();
            setProblem(null);
          }}
          onProblem={showProblem}
          teachButton={teachButton}
          photo={photo?.url ?? null}
          onPhoto={(file) =>
            shrinkPhoto(file).then(
              (blob) => {
                clearPhoto();
                setPhoto({ blob, url: URL.createObjectURL(blob) });
              },
              () => showProblem("That photo didn't open. Try taking it again."),
            )
          }
          onClearPhoto={clearPhoto}
        />
      </footer>

      <AnimatePresence>
        {teach.step === "picking" && <TeachPicker brain={brain} onPick={(t) => void startTeaching(t)} onClose={closePicker} />}
      </AnimatePresence>
    </main>
  );
}
