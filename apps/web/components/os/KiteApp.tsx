"use client";

import { NO_TURN, type Brain, type DeviceKind, type Grade, type Teachable, type TurnView } from "@kite/client";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CreationCard } from "@/components/creations/CreationCard";
import { KiteMark } from "@/components/kit/KiteMark";
import { AnswerCard, Dots } from "@/components/os/AnswerCard";
import { Attach } from "@/components/os/Attach";
import { Burst } from "@/components/os/Burst";
import { Dock } from "@/components/os/Dock";
import { Glyph } from "@/components/os/Glyph";
import { Home, type Tile } from "@/components/os/Home";
import { base64Of, shrinkPhoto, useVoice } from "@/components/os/media";
import { PastChats } from "@/components/os/PastChats";
import { BedtimeSwitch, StoryChoices, storyAsk, type StoryKind } from "@/components/os/Story";
import { TeachPicker } from "@/components/os/TeachPicker";
import s from "@/components/os/os.module.css";
import { aboutWords, KITE_WILL, type Assignment } from "@/components/shell/classroom";
import { Window } from "@/components/shell/Window";
import { SPRING, bandFor, type Band } from "@/lib/band";
import { KID_ID, useBrainEvents, useTalk } from "@/lib/brain";
import { reduceCreations, type CreationEntry, type CreationKind, type CreationStatus, type Creations } from "@/lib/creations";
import { playSound, setSoundBand } from "@/lib/sound";

type Photo = { blob: Blob; url: string };
/** Which screen of the Kite app the kid is on. Talk, Teach and Make share one stage: Kite, its words, and the diamond. */
type View =
  | { kind: "home" }
  | { kind: "talk" }
  | { kind: "teach"; concept: Teachable }
  | { kind: "make"; make: MakeKind }
  | { kind: "past"; back: "home" | "talk" };
/** What the stage shows, derived each render. Listening wins: the kid can always talk over Kite. */
type Look = "idle" | "listening" | "thinking" | "speaking";

/**
 * Where the one Kite of this page shows. The shell keeps it mounted, so its turns, creations and voice survive:
 * the Kite app in a window, the Ask Kite panel over another app, or the Ask Kite bar (the phone's walkie-talkie dock)
 * when neither is open.
 */
export type Surface = "window" | "panel" | "bar" | "phone";
/** Asks from the shell: open the app at a page, take a picture, or send a question. `n` changes for each ask. */
export interface KiteRequest {
  n: number;
  to: "home" | "talk" | "story" | "camera";
  text?: string;
}

const NUDGE: Record<Band, string> = {
  k2: "Hold the diamond and ask me anything.",
  g35: "What are you wondering about today?",
  g68: "What's on your mind?",
  g912: "Ask me anything.",
};
const LISTENING: Record<Band, string> = { k2: "I'm listening!", g35: "I'm listening…", g68: "Listening…", g912: "Listening…" };
/** What a tile asks her to name. A story is a creation too, made by the brain's story tool from the same kind of ask. */
type MakeKind = CreationKind | "story";
const MAKE_PROMPT: Record<MakeKind, string> = {
  movie: "What should your movie be about?",
  game: "What should your game be about?",
  story: "What should the story be about?",
};
// A chip says what the kid would say, so the brain's own turn picks the topic and the goal from the conversation.
const MAKE_ASK: Record<CreationKind, string> = { movie: "Make that into a movie", game: "Make a game about that" };
const MAKE_CHIP: Record<CreationKind | "story", { label: string; busy: string; open: string; special: string }> = {
  movie: { label: "Make it a movie", busy: "Making your movie", open: "Watch your movie", special: "Watch Kite's special version" },
  game: { label: "Make a game", busy: "Making your game", open: "Play your game", special: "Play your brand-new game" },
  story: { label: "Tell me a story", busy: "Writing your story", open: "Read your story", special: "Read your story" },
};
// ponytail: a PDF is chosen and named but never uploaded. Upgrade path: send it with the turn and let the brain
// pass the text to Claude as a document block, behind the same Content Safety check a photo gets.
const PDF_NOTE = "I can't read PDFs yet. Ask me about it and I'll help!";
const MISSED = "Kite didn't catch that. Hold the diamond and say it again.";
// Allows for the brain's clock running a little ahead of this one.
const REPLAY_SLACK_MS = 3000;

export interface KiteAppProps {
  brain: Brain;
  device: DeviceKind;
  name: string | null;
  grade: number;
  muted: boolean;
  surface: Surface;
  /** The assignment on screen, when there is one: what she asks rides with its title. */
  about: Assignment | null;
  request: KiteRequest | null;
  /** Kite asks the shell to show it as the app, as the panel, or to put it away. */
  onShow: (show: "window" | "panel" | "closed") => void;
  /** The dock's icons on each side of the diamond: the shelf on the Chromebook, call and camera on the phone. */
  sides?: { left: ReactNode; right: ReactNode };
}

export function KiteApp({ brain, device, name, grade, muted, surface, about, request, onShow, sides }: KiteAppProps) {
  const talk = useTalk(brain);
  const reduce = useReducedMotion();
  const [view, setView] = useState<View>({ kind: "home" });
  const [picking, setPicking] = useState(false);
  const [opener, setOpener] = useState<string | null>(null);
  const [creations, setCreations] = useState<Creations>([]);
  const [anchors, setAnchors] = useState<Record<string, string>>({});
  // A turn's first creation, once closed, stays closed until its status changes, so a movie closed while it was
  // being made rises again when it's ready. Follow-ups show only once she opens them from the answer card.
  const [closed, setClosed] = useState<Record<string, CreationStatus>>({});
  const [followUps, setFollowUps] = useState<ReadonlySet<string>>(new Set());
  const [making, setMaking] = useState<ReadonlySet<string>>(new Set());
  const [opened] = useState(() => Date.now());
  // Turns replayed from before this page opened, and turns put away by New topic. Neither shows on the stage.
  const [earlier, setEarlier] = useState<ReadonlySet<string>>(new Set());
  const [cleared, setCleared] = useState<ReadonlySet<string>>(new Set());
  // Turns asked in the current Teach Kite lesson: the teach stage shows only those.
  const [lesson, setLesson] = useState<ReadonlySet<string>>(new Set());
  // Turns asked through Ask Kite since the panel last opened: the panel shows only those.
  const [asked, setAsked] = useState<ReadonlySet<string>>(new Set());
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [pdf, setPdf] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [storyKind, setStoryKind] = useState<StoryKind>("fun");
  const [bedtime, setBedtime] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [party, setParty] = useState(0);
  const [cheering, setCheering] = useState(false);
  // From the kid letting go until the brain has the turn: the gap before the turn exists to show as thinking.
  const [sending, setSending] = useState(false);
  const [hearing, setHearing] = useState(false);
  const [listening, setListening] = useState(false);
  const started = useRef(new Set<string>());
  const celebrated = useRef(new Set<string>());
  const camera = useRef<HTMLInputElement>(null);
  const band = bandFor(grade);
  const { saying, hush } = useVoice(brain, muted);
  const inApp = surface === "window";
  // The panel and the bar always talk: Teach Kite and the makers live in the app.
  const stage: View = inApp ? view : { kind: "talk" };
  const topic = inApp ? null : about;

  useEffect(() => setSoundBand(band), [band]);

  // Put away, Kite stops talking, and the panel starts clean next time it opens.
  useEffect(() => {
    if (surface === "bar" || surface === "phone") {
      hush();
      setAsked(new Set());
    }
  }, [surface]);

  useBrainEvents(brain, (e) => {
    const replayed = Date.parse(e.at) < opened - REPLAY_SLACK_MS;
    setCreations((list) => reduceCreations(list, e));
    // A creation belongs to the turn that asked for it. One started elsewhere, live, belongs to the latest turn.
    if (e.type === "creation.progress" || e.type === "creation.ready") {
      const turn = e.turn_id ?? (replayed ? undefined : brain.talk.getState().turns.at(-1)?.id);
      if (turn) setAnchors((a) => (a[e.creation_id] ? a : { ...a, [e.creation_id]: turn }));
    }
    // The Teach Kite opener is the only sentence with no turn. One this screen didn't start came from the kid asking
    // out loud here, so the screen follows into the lesson the brain began.
    if (e.type === "answer.sentence" && e.turn_id === null) {
      setOpener(e.text);
      const latest = brain.talk.getState().turns.filter((t) => t.id !== NO_TURN).at(-1);
      if (!replayed && view.kind !== "teach" && latest?.mine) followTeach();
    }
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
  const addPhoto = (file: File) =>
    shrinkPhoto(file).then(
      (blob) => {
        clearPhoto();
        setPhoto({ blob, url: URL.createObjectURL(blob) });
        if (!inApp) onShow("panel");
      },
      () => showProblem("That picture didn't open. Try another one."),
    );

  /** Resolves false when the brain didn't take the turn; the kid has already been told. */
  const ask = async (utterance: { text: string } | { audio: Blob }): Promise<boolean> => {
    setProblem(null);
    setNote(pdf ? PDF_NOTE : null);
    setPdf(null);
    const image = photo?.blob;
    clearPhoto();
    const teaching = stage.kind === "teach" ? stage.concept : null;
    const lessonMode = teaching ? { mode: "teach" as const, conceptId: teaching.concept_id } : {};
    const words = "text" in utterance && topic ? { text: aboutWords(topic.title, utterance.text) } : utterance;
    setSending(true);
    try {
      const id = await brain.say({ ...words, ...lessonMode, ...(image ? { image } : {}), asOfGrade: grade as Grade });
      if (teaching) setLesson((l) => new Set(l).add(id));
      if (!inApp) setAsked((a) => new Set(a).add(id));
      return true;
    } catch {
      showProblem("Kite didn't get that. Try sending it again.");
      return false;
    } finally {
      setSending(false);
    }
  };

  /** Only the words of a take, for an ask that has to carry more than her voice. "" when nothing was heard. */
  const heard = async (audio: Blob): Promise<string> => {
    setHearing(true);
    try {
      const { text } = await brain.post<{ text: string }>(`/kids/${KID_ID}/hear`, {
        audio_b64: await base64Of(audio),
        mime: audio.type.split(";")[0] || "audio/webm",
      });
      return text;
    } catch {
      return "";
    } finally {
      setHearing(false);
    }
  };
  // About an assignment, a spoken question goes as words, so it can name the assignment for the homework guard.
  const askAloud = async (audio: Blob) => {
    if (!topic) return void ask({ audio });
    const text = await heard(audio);
    if (text) void ask({ text });
    else showProblem(MISSED);
  };

  const make = async (t: TurnView, kind: CreationKind) => {
    const key = `${t.id}:${kind}`;
    setMaking((m) => new Set(m).add(key));
    hush();
    if (await ask({ text: MAKE_ASK[kind] })) return;
    setMaking((m) => {
      const next = new Set(m);
      next.delete(key);
      return next;
    });
  };

  // From the Make and Story tiles: the kid names a topic, and it goes to the brain as an ordinary ask, so Kite's own
  // tools pick the learning goal and the creation rises on the talk stage.
  const makeAbout = (kind: MakeKind, said: string) => {
    const topicSaid = said.replace(/[.!?]+$/, "");
    setView({ kind: "talk" });
    void ask({ text: kind === "story" ? storyAsk(storyKind, topicSaid, bedtime) : `Make a ${kind} about ${topicSaid}` });
  };
  const hearTopic = async (kind: MakeKind, audio: Blob) => {
    const text = await heard(audio);
    if (text) makeAbout(kind, text);
    else showProblem(MISSED);
  };

  const followTeach = () =>
    brain.get<Teachable | null>(`/kids/${KID_ID}/teach/active`).then(
      (concept) => {
        if (!concept) return;
        setLesson(new Set());
        setView({ kind: "teach", concept });
        onShow("window");
      },
      () => showProblem("Kite couldn't start listening. Try Teach Kite again."),
    );

  const startTeaching = async (concept: Teachable) => {
    setPicking(false);
    setLesson(new Set());
    setView({ kind: "teach", concept });
    setOpener(null);
    setProblem(null);
    try {
      await brain.startTeach(concept.concept_id);
    } catch {
      setView({ kind: "talk" });
      showProblem("Kite couldn't start listening. Try Teach Kite again.");
    }
  };

  const go = (next: View) => {
    if (next.kind === "home") hush();
    setProblem(null);
    setView(next);
  };
  const openTile = (tile: Tile) => {
    playSound("whoosh");
    if (tile === "teach") setPicking(true);
    else if (tile === "movie" || tile === "game" || tile === "story") {
      setStoryKind("fun");
      go({ kind: "make", make: tile });
    } else if (tile === "past") go({ kind: "past", back: "home" });
    else {
      go({ kind: "talk" });
      if (tile === "camera") camera.current?.click();
    }
  };
  const closePicker = useCallback(() => setPicking(false), []);

  // The shell's asks. Keyed on `n`, so the same ask twice is two asks.
  useEffect(() => {
    if (!request) return;
    if (request.to === "camera") {
      go({ kind: "talk" });
      camera.current?.click();
    } else if (request.to === "story") {
      setStoryKind("fun");
      go({ kind: "make", make: "story" });
    } else go({ kind: request.to });
    if (request.text) void ask({ text: request.text });
  }, [request?.n]);

  // Every turn on screen so far goes, and the brain stops leaning on them. What Kite remembers stays.
  const newTopic = async () => {
    hush();
    setProblem(null);
    try {
      await brain.post(`/kids/${KID_ID}/fresh-start`);
    } catch {
      showProblem("Kite couldn't start a new topic. Try again.");
      return;
    }
    playSound("whoosh");
    setCleared((c) => new Set([...c, ...brain.talk.getState().turns.map((t) => t.id)]));
    setNote(null);
    setPdf(null);
    clearPhoto();
  };

  const live = talk.turns.filter(
    (t) => t.id !== NO_TURN && !earlier.has(t.id) && !cleared.has(t.id) && (t.mine || t.heard || t.sentences.length > 0),
  );
  const liveIds = new Set<string>(live.map((t) => t.id));
  const current = !inApp
    ? live.filter((t) => asked.has(t.id)).at(-1)
    : stage.kind === "teach"
      ? live.filter((t) => lesson.has(t.id)).at(-1)
      : stage.kind === "talk"
        ? live.at(-1)
        : undefined;
  const pending = talk.turns.some((t) => t.mine && t.id !== NO_TURN && !t.done && t.sentences.length === 0);
  const thinking = sending || hearing || pending;
  const look: Look = listening ? "listening" : thinking ? "thinking" : saying ? "speaking" : "idle";
  const busy = sending || hearing || listening || pending;
  const onStage = stage.kind === "talk" || stage.kind === "teach" || stage.kind === "make";
  const storyStage = stage.kind === "make" && stage.make === "story";
  // Kite's first movie or game for a turn rises as soon as Kite starts it, and again once it's ready if she closed it
  // while it was being made. A follow-up of the same kind (Kite's special version, which the brain starts on its own
  // and can finish minutes later) never rises by itself, so nothing covers the stage unasked: the answer card offers
  // it. `anchors` keeps first-seen order.
  const kindOf = new Map(creations.map((c) => [c.id, c.kind]));
  const firstFor = new Map<string, string>();
  for (const [id, turn] of Object.entries(anchors)) {
    const key = `${turn}:${kindOf.get(id)}`;
    if (kindOf.has(id) && !firstFor.has(key)) firstFor.set(key, id);
  }
  const isFirst = (c: CreationEntry) => firstFor.get(`${anchors[c.id]}:${c.kind}`) === c.id;
  const isOpen = (c: CreationEntry) => (isFirst(c) ? closed[c.id] !== c.status : followUps.has(c.id));
  const rising = inApp && stage.kind === "talk" ? creations.filter((c) => liveIds.has(anchors[c.id]) && isOpen(c)) : [];
  const openCreation = (c: CreationEntry) =>
    isFirst(c)
      ? setClosed((x) => {
          const next = { ...x };
          delete next[c.id];
          return next;
        })
      : setFollowUps((o) => new Set(o).add(c.id));
  const closeCreation = (c: CreationEntry) =>
    isFirst(c)
      ? setClosed((x) => ({ ...x, [c.id]: c.status }))
      : setFollowUps((o) => {
          const next = new Set(o);
          next.delete(c.id);
          return next;
        });

  const chipsFor = (t: TurnView): ReactNode => {
    if (!inApp || stage.kind !== "talk" || t !== current || t.done?.route !== "answer" || !t.heard || !t.sentences.length) return null;
    const below = creations.filter((c) => anchors[c.id] === t.id);
    return (
      <div className={s.makes}>
        {(["movie", "game"] as const)
          .filter((kind) => !below.some((c) => c.kind === kind))
          .map((kind) => {
            const pressed = making.has(`${t.id}:${kind}`);
            return (
              <button key={kind} type="button" className={s.make} disabled={pressed} onClick={() => void make(t, kind)}>
                <Glyph name={kind} size={18} />
                {pressed ? MAKE_CHIP[kind].busy : MAKE_CHIP[kind].label}
              </button>
            );
          })}
        {below
          .filter((c) => !isOpen(c) && (isFirst(c) || c.status !== "making"))
          .map((c) => (
            <button key={c.id} type="button" className={s.make} onClick={() => openCreation(c)}>
              <Glyph name={c.kind === "story" ? "book" : c.kind} size={18} />
              {isFirst(c) ? MAKE_CHIP[c.kind].open : MAKE_CHIP[c.kind].special}
            </button>
          ))}
      </div>
    );
  };

  const caption =
    look === "listening"
      ? LISTENING[band]
      : stage.kind === "make"
        ? hearing ? "Got it…" : MAKE_PROMPT[stage.make]
        : stage.kind === "teach"
          ? (opener ?? "Kite is getting ready to listen.")
          : topic
            ? `What do you want to ask about ${topic.title}?`
            : NUDGE[band];
  const asker = (t: TurnView): DeviceKind | null => (t.mine ? device : device === "os" ? "handheld" : "os");

  const pill = (glyph: Parameters<typeof Glyph>[0]["name"], label: string, onClick: () => void, disabled = false) => (
    <button type="button" className={s.pill} onClick={onClick} disabled={disabled}>
      <Glyph name={glyph} size={20} />
      {label}
    </button>
  );
  const teachButton =
    stage.kind === "teach" ? (
      <button type="button" className={s.teachButton} data-on="true" onClick={() => go({ kind: "talk" })}>
        <Glyph name="close" size={20} />
        Stop teaching
      </button>
    ) : (
      <button
        type="button"
        className={s.teachButton}
        onClick={() => {
          playSound("whoosh");
          setPicking(true);
        }}
      >
        <Glyph name="teach" size={20} />
        Teach Kite
      </button>
    );
  const cameraButton = (
    <button type="button" className={s.side} onClick={() => camera.current?.click()}>
      <Glyph name="camera" size={26} />
      What&apos;s this?
    </button>
  );
  const attach = <Attach onPicture={(f) => void addPhoto(f)} onPdf={(f) => setPdf(f.name)} />;
  const attached = (photo || pdf) && (
    <div className={s.attached}>
      {photo && (
        <div className={s.chip}>
          <img src={photo.url} alt="Your picture, sent with your next question" />
          <span>Kite will look at this</span>
          <button type="button" className={s.iconButton} onClick={clearPhoto} aria-label="Remove the picture">
            <Glyph name="close" size={18} />
          </button>
        </div>
      )}
      {pdf && (
        <div className={s.chip}>
          <span className={s.chipIcon}>
            <Glyph name="pdf" size={26} />
          </span>
          <span>{pdf}</span>
          <button type="button" className={s.iconButton} onClick={() => setPdf(null)} aria-label="Remove the PDF">
            <Glyph name="close" size={18} />
          </button>
        </div>
      )}
    </div>
  );
  const cameraInput = (
    <input
      ref={camera}
      className={s.hidden}
      type="file"
      accept="image/*"
      capture="environment"
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) void addPhoto(file);
        e.target.value = "";
      }}
    />
  );
  const micEvents = (on: boolean) => {
    setListening(on);
    if (!on) return;
    hush();
    setProblem(null);
  };

  // The bar and the phone dock: only the diamond and its neighbours. Holding it asks Kite right here, and the answer
  // opens in the panel.
  if (surface === "bar" || surface === "phone") {
    return (
      <div className={s.askBar} data-surface={surface} data-device={device}>
        {problem && (
          <p className={s.problem} role="alert">
            {problem}
          </p>
        )}
        <Dock
          key={surface}
          plain
          device={device}
          band={band}
          teaching={false}
          thinking={thinking}
          holdLabel={topic && device === "os" ? "Ask Kite about this" : "Ask Kite"}
          placeholder="Ask Kite"
          hasPhoto={false}
          onSend={() => {}}
          onAudio={(audio) => {
            onShow("panel");
            void askAloud(audio);
          }}
          onTap={() => onShow("panel")}
          onMic={micEvents}
          onProblem={showProblem}
          left={sides?.left}
          right={sides?.right}
        />
        {cameraInput}
      </div>
    );
  }

  const stageView = (
    <>
      <section className={s.stage} data-look={look} aria-label={stage.kind === "teach" ? "Teach Kite" : "Talk with Kite"}>
        {stage.kind === "teach" && (
          <div className={s.teachBar}>
            <span className={s.teachWhat}>You&apos;re teaching Kite</span>
            <strong>{stage.concept.kid_name}</strong>
          </div>
        )}
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
        <div className={s.scene} data-card={current !== undefined || storyStage}>
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
              <KiteMark size={150} speaking={saying !== null} label={saying ? "Kite, talking" : "Kite"} />
            </motion.div>
            {cheering && !reduce && <Burst key={`burst-${party}`} />}
          </div>
          <div className={s.words}>
            <AnimatePresence mode="wait" initial={false}>
              {current ? (
                <AnswerCard key={current.id} band={band} turn={current} asker={asker(current)} saying={saying} chips={chipsFor(current)} />
              ) : (
                <motion.p
                  key={`${stage.kind}:${look === "listening" ? "listening" : look === "thinking" ? "thinking" : caption}`}
                  className={s.caption}
                  initial={{ opacity: 0, transform: reduce ? "none" : "translateY(6px)" }}
                  animate={{ opacity: 1, transform: "translateY(0px)" }}
                  exit={{ opacity: 0, transition: { duration: 0.15 } }}
                  transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
                >
                  {look === "thinking" && stage.kind !== "make" ? <Dots label="Kite is thinking" /> : caption}
                </motion.p>
              )}
            </AnimatePresence>
            {/* During a live quiz its questions aren't offered: Kite is paused for it, and the chip says so. */}
            {topic && topic.status !== "exam_live" && topic.questions.length > 0 && (
              <div className={s.questions} aria-label={`Questions in ${topic.title}`}>
                {topic.questions.slice(0, 4).map((q, i) => (
                  <button
                    key={q}
                    type="button"
                    className={s.question}
                    disabled={busy}
                    onClick={() => void ask({ text: `Can you help me with question ${i + 1}? ${q}` })}
                  >
                    <span className={s.questionNumber}>{i + 1}</span>
                    {q}
                  </button>
                ))}
              </div>
            )}
            {storyStage && !hearing && <StoryChoices kind={storyKind} onPick={setStoryKind} />}
            {note && (
              <p className={s.note} role="status">
                {note}
              </p>
            )}
          </div>
        </div>
        {/* A movie or game rises over the stage, never over the diamond, so she can still talk while it plays. */}
        <AnimatePresence>
          {rising.length > 0 && (
            <motion.div
              className={s.sheet}
              initial={{ opacity: 0, transform: reduce ? "none" : "translateY(48px)" }}
              animate={{ opacity: 1, transform: "translateY(0px)" }}
              exit={{ opacity: 0, transform: reduce ? "none" : "translateY(48px)" }}
              transition={SPRING[band]}
            >
              {rising.map((c) => (
                <div key={c.id} className={s.sheetItem}>
                  <button type="button" className={s.pill} onClick={() => closeCreation(c)}>
                    <Glyph name="close" size={20} />
                    Close
                  </button>
                  <CreationCard brain={brain} creation={c} />
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </section>
      <footer className={s.bottom}>
        {problem && (
          <p className={s.problem} role="alert">
            {problem}
          </p>
        )}
        <Dock
          key={stage.kind}
          device={device}
          band={band}
          teaching={stage.kind === "teach"}
          thinking={thinking}
          holdLabel={stage.kind === "make" ? "Hold and say it" : "Hold to talk"}
          placeholder={stage.kind === "teach" ? "Type what you know" : stage.kind === "make" ? "Type what it's about" : "Type a question"}
          hasPhoto={photo !== null}
          onSend={(text) => (stage.kind === "make" ? makeAbout(stage.make, text) : void ask({ text }))}
          onAudio={(audio) => (stage.kind === "make" ? void hearTopic(stage.make, audio) : void askAloud(audio))}
          onMic={micEvents}
          onProblem={showProblem}
          left={
            stage.kind === "make" ? (
              stage.make === "story" ? <BedtimeSwitch on={bedtime} onChange={setBedtime} /> : null
            ) : !inApp || (device === "handheld" && stage.kind === "talk") ? (
              cameraButton
            ) : (
              teachButton
            )
          }
          right={stage.kind === "talk" ? attach : null}
          extras={
            inApp && device === "handheld" && stage.kind === "talk" ? (
              <>
                {teachButton}
                {pill("chats", "Past chats", () => go({ kind: "past", back: "talk" }))}
              </>
            ) : null
          }
          attached={stage.kind === "make" ? null : attached}
        />
      </footer>
    </>
  );

  const body = (
    <div
      className={s.screen}
      data-device={device}
      data-view={stage.kind}
      data-bedtime={storyStage && bedtime}
      data-sheet={rising.length > 0}
      data-surface={surface}
    >
      {stage.kind === "home" && <Home name={name} band={band} device={device} onOpen={openTile} />}
      {stage.kind === "past" && <PastChats brain={brain} onBack={() => go(stage.back === "talk" ? { kind: "talk" } : { kind: "home" })} />}
      {onStage && stageView}
      {cameraInput}
      <AnimatePresence>
        {picking && <TeachPicker brain={brain} onPick={(t) => void startTeaching(t)} onClose={closePicker} />}
      </AnimatePresence>
    </div>
  );

  if (surface === "panel") {
    return (
      <motion.section
        className={s.panel}
        role="dialog"
        aria-label="Ask Kite"
        initial={{ opacity: 0, transform: reduce ? "none" : "translateY(32px) scale(0.98)" }}
        animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
        transition={SPRING[band]}
      >
        <header className={s.panelHead}>
          <span className={s.panelMark} aria-hidden="true">
            <Glyph name="sparkle" size={20} />
          </span>
          <h2 className={s.panelTitle}>Ask Kite</h2>
          {topic && (
            <span className={s.about} data-status={topic.status}>
              <strong>{topic.title}</strong>
              <span>{KITE_WILL[topic.status]}</span>
            </span>
          )}
          <button type="button" className={s.iconButton} onClick={() => onShow("closed")} aria-label="Close Ask Kite">
            <Glyph name="close" size={20} />
          </button>
        </header>
        {body}
      </motion.section>
    );
  }

  const back = () => {
    if (view.kind === "past") go(view.back === "talk" ? { kind: "talk" } : { kind: "home" });
    else if (view.kind !== "home") go({ kind: "home" });
    else onShow("closed");
  };
  return (
    <Window
      title="Kite"
      tone="kite"
      icon={<KiteMark size={22} />}
      label="Kite"
      onBack={back}
      onClose={() => onShow("closed")}
      className={s.kiteWindow}
      actions={
        view.kind === "talk" ? (
          <>
            {pill("fresh", "New topic", () => void newTopic(), busy)}
            {device === "os" && pill("chats", "Past chats", () => go({ kind: "past", back: "talk" }))}
          </>
        ) : null
      }
    >
      {body}
    </Window>
  );
}
