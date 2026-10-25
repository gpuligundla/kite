"use client";

import type { Brain } from "@kite/client";
// Deep imports: the package index pulls in Remotion, which these two plain modules don't need.
import { Background } from "@kite/movie/src/backgrounds";
import { resolveSprite } from "@kite/movie/src/sprites";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Answers } from "@/components/creations/Answers";
import type { Loaded } from "@/components/creations/CreationCard";
import { KID_ID } from "@/lib/brain";
import type { CreationEntry } from "@/lib/creations";
import { playSound, setVoiceActive } from "@/lib/sound";
import styles from "./story.module.css";

export interface StoryPlayerProps {
  brain: Brain;
  creation: CreationEntry;
  /** GET /creations/{id} as CreationCard fetches it. */
  data: Loaded;
}

type Book = NonNullable<Loaded["storybook"]>;
type Page = Book["pages"][number];
type Word = { text: string; start: number; end: number };
/** Where the reader is. `line === lines.length` is the rest before the page turns; `page === pages.length` is the ending. */
type Spot = { page: number; line: number };

const REST_MS = { story: 900, bedtime: 2200 };
const READ_S_PER_WORD = { story: 0.42, bedtime: 0.55 }; // a line with no narration turns on this clock
const MUSIC_VOLUME = { story: 0.14, bedtime: 0.1 };
const SFX_VOLUME = { story: 0.55, bedtime: 0.35 };
const MUSIC_FADE_MS = { story: 2500, bedtime: 8000 };
const GROUND = (720 - 435) / 720; // @kite/movie's GROUND_Y, as a share of the scene's height from the bottom

const lineKey = (page: number, line: number) => `${page}-${line}`;
const plain = (text: string) => text.replace(/\[[^\]]*\]\s*/g, "").trim();
const bare = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

/** One storybook, read aloud page by page: Kite's narration with word highlighting, sound effects on their cues and a music bed underneath. */
export function StoryPlayer({ brain, creation, data }: StoryPlayerProps) {
  if (!data.storybook) return <p className={styles.missing}>Kite couldn't open this story. Ask for another one.</p>;
  return <Storybook brain={brain} fallback={creation.status === "fallback"} data={data} book={data.storybook} />;
}

function Storybook({ brain, fallback, data, book }: { brain: Brain; fallback: boolean; data: Loaded; book: Book }) {
  const mode = book.mode;
  const pages = book.pages;
  const root = useRef<HTMLElement>(null);
  const [spot, setSpot] = useState<Spot>({ page: 0, line: 0 });
  const [dir, setDir] = useState<1 | -1>(1);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [word, setWord] = useState(-1);
  const [full, setFull] = useState(false);
  const name = useKidName(brain, mode === "bedtime");
  const media = useMedia(data);
  const atEnd = spot.page >= pages.length;

  const wordsOf = useCallback(
    (page: number, line: number): Word[] => {
      const timed = data.timings[lineKey(page, line)];
      if (timed?.length) return timed;
      const per = READ_S_PER_WORD[mode];
      return plain(pages[page].lines[line].text).split(/\s+/).map((text, i) => ({ text, start: i * per, end: (i + 1) * per }));
    },
    [data.timings, mode, pages],
  );

  // The reading engine: play the line at `spot`, light its words, fire its sound cues, then move on.
  useEffect(() => {
    if (!playing || atEnd) return;
    const page = pages[spot.page];
    if (spot.line >= page.lines.length) {
      const rest = setTimeout(() => {
        setDir(1);
        setSpot({ page: spot.page + 1, line: 0 });
      }, REST_MS[mode]);
      return () => clearTimeout(rest);
    }
    const words = wordsOf(spot.page, spot.line);
    const cues = page.sounds.flatMap((cue, n) => {
      const sound = media.current.sfx.get(`sfx-${spot.page}-${n}`);
      if (!sound || cue.line !== spot.line) return [];
      const hit = words.find((w) => bare(w.text) === bare(cue.word));
      return [{ sound, at: hit?.start ?? 0, fired: false }];
    });
    const voice = media.current.lines.get(lineKey(spot.page, spot.line));
    const begun = performance.now();
    const clock = voice ? () => voice.currentTime : () => (performance.now() - begun) / 1000;
    const done = () => setSpot({ page: spot.page, line: spot.line + 1 });
    let frame = 0;
    let reading: ReturnType<typeof setTimeout> | undefined;

    const tick = () => {
      const t = clock();
      let lit = -1;
      for (let i = 0; i < words.length && words[i].start <= t; i++) lit = i;
      setWord(lit);
      for (const cue of cues) {
        if (!cue.fired && t >= cue.at) {
          cue.fired = true;
          cue.sound.currentTime = 0;
          void cue.sound.play().catch(() => {});
        }
      }
      frame = requestAnimationFrame(tick);
    };

    if (voice) {
      if (voice.ended) voice.currentTime = 0;
      voice.onended = done;
      setVoiceActive(true);
      void voice.play().catch(() => setPlaying(false)); // autoplay refused: the play button is still there
    } else {
      reading = setTimeout(done, (words.at(-1)?.end ?? 2) * 1000 + 400);
    }
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(reading);
      if (voice) {
        voice.onended = null;
        voice.pause();
      }
      setVoiceActive(false);
      setWord(-1);
    };
  }, [playing, atEnd, spot, pages, mode, wordsOf, media]);

  // The music bed follows play and pause, and fades out at the end.
  useEffect(() => {
    const music = media.current.music;
    if (!music) return;
    if (!playing && !atEnd) {
      music.pause();
      return;
    }
    if (!started) return;
    if (!atEnd) {
      music.volume = MUSIC_VOLUME[mode];
      void music.play().catch(() => {});
      return;
    }
    const from = music.volume;
    const begun = performance.now();
    let frame = 0;
    const fade = () => {
      const left = 1 - (performance.now() - begun) / MUSIC_FADE_MS[mode];
      music.volume = Math.max(0, from * left);
      if (left > 0) frame = requestAnimationFrame(fade);
      else music.pause();
    };
    frame = requestAnimationFrame(fade);
    return () => cancelAnimationFrame(frame);
  }, [playing, started, atEnd, mode, media]);

  // At the end of a day story, Kite asks its question aloud once per reading.
  const ask = book.check ? data.audio.check : book.reflection ? data.audio.reflection : undefined;
  useEffect(() => {
    if (!atEnd || !started || !ask) return;
    const question = new Audio(ask);
    setVoiceActive(true);
    question.onended = () => setVoiceActive(false);
    void question.play().catch(() => setVoiceActive(false));
    return () => {
      question.pause();
      setVoiceActive(false);
    };
  }, [atEnd, started, ask]);

  useEffect(() => {
    const sync = () => setFull(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const go = (page: number) => {
    const to = Math.max(0, Math.min(pages.length, page));
    if (to === spot.page) return;
    const left = media.current.lines.get(lineKey(spot.page, spot.line));
    if (left) left.currentTime = 0; // coming back to this page reads it from the top
    setDir(to > spot.page ? 1 : -1);
    setSpot({ page: to, line: 0 });
  };
  const readFromStart = () => {
    setDir(-1);
    setSpot({ page: 0, line: 0 });
    setStarted(true);
    setPlaying(true);
  };
  const toggle = () => {
    if (atEnd) return readFromStart();
    setStarted(true);
    setPlaying((p) => !p);
  };
  const fullScreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void root.current?.requestFullscreen?.().catch(() => {});
  };

  return (
    <section ref={root} className={styles.story} data-mode={mode} data-full={full || undefined} aria-label={book.title}>
      {mode === "bedtime" && <Stars />}
      <header className={styles.head}>
        <h3 className={styles.title}>{book.title}</h3>
        {fallback && <p className={styles.note}>Kite couldn&apos;t finish your story, so here&apos;s one of its favorites.</p>}
      </header>
      <div className={styles.book}>
        {atEnd ? (
          <div key="end" className={styles.spread} data-dir={dir}>
            <Ending brain={brain} id={data.id} book={book} name={name} again={readFromStart} />
          </div>
        ) : (
          <div key={spot.page} className={styles.spread} data-dir={dir}>
            <Scene page={pages[spot.page]} sprites={data.sprites} speaker={pages[spot.page].lines[spot.line]} />
            <div className={styles.words}>
              {pages[spot.page].lines.map((line, n) => (
                <p key={n} className={styles.line} data-now={(started && n === spot.line) || undefined}>
                  {line.voice !== "kite" && <span className={styles.speaker}>{line.speaker}</span>}
                  {wordsOf(spot.page, n).map((w, i) => (
                    <Fragment key={i}>
                      <span className={styles.word} data-on={(n === spot.line && i === word) || undefined}>
                        {w.text}
                      </span>{" "}
                    </Fragment>
                  ))}
                </p>
              ))}
              <span className={styles.folio}>{spot.page + 1}</span>
            </div>
          </div>
        )}
        {!started && (
          <button type="button" className={styles.start} onClick={toggle}>
            <span className={styles.startIcon} aria-hidden />
            {mode === "bedtime" ? "Read me to sleep" : "Read to me"}
          </button>
        )}
      </div>
      <nav className={styles.controls} aria-label="Story controls">
        <button type="button" className={styles.control} onClick={() => go(spot.page - 1)} disabled={spot.page === 0} aria-label="Previous page">
          <Icon d="M15 5 8 12l7 7" />
        </button>
        <button type="button" className={styles.play} onClick={toggle} aria-label={atEnd ? "Read it again" : playing ? "Pause" : "Play"}>
          {atEnd ? <Icon d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" /> : playing ? <Icon d="M8 5v14M16 5v14" /> : <Icon d="M8 5l11 7-11 7z" fill />}
        </button>
        <button type="button" className={styles.control} onClick={() => go(spot.page + 1)} disabled={atEnd} aria-label="Next page">
          <Icon d="m9 5 7 7-7 7" />
        </button>
        <ol className={styles.dots} aria-label={`Page ${Math.min(spot.page + 1, pages.length)} of ${pages.length}`}>
          {pages.map((_, i) => (
            <li key={i} data-on={i === spot.page || undefined} data-read={i < spot.page || undefined} />
          ))}
        </ol>
        <button type="button" className={styles.control} onClick={fullScreen} aria-label={full ? "Leave full screen" : "Full screen"}>
          <Icon d={full ? "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" : "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"} />
        </button>
      </nav>
    </section>
  );
}

/** Every line and sound, preloaded once. Audio exists only in the browser, so it's made in an effect. */
function useMedia(data: Loaded) {
  const media = useRef({ lines: new Map<string, HTMLAudioElement>(), sfx: new Map<string, HTMLAudioElement>(), music: undefined as HTMLAudioElement | undefined });
  useEffect(() => {
    const made = { lines: new Map<string, HTMLAudioElement>(), sfx: new Map<string, HTMLAudioElement>(), music: undefined as HTMLAudioElement | undefined };
    const mode = data.storybook?.mode ?? "story";
    for (const [key, url] of Object.entries(data.audio)) {
      const a = new Audio(url);
      a.preload = "auto";
      if (key === "music") {
        a.loop = true;
        a.volume = MUSIC_VOLUME[mode];
        made.music = a;
      } else if (key.startsWith("sfx-")) {
        a.volume = SFX_VOLUME[mode];
        made.sfx.set(key, a);
      } else if (/^\d+-\d+$/.test(key)) {
        made.lines.set(key, a);
      }
    }
    media.current = made;
    return () => {
      for (const a of [...made.lines.values(), ...made.sfx.values(), made.music]) a?.pause();
    };
  }, [data]);
  return media;
}

/** The kid's first name, for goodnight. It comes from their own device, never from the story. */
function useKidName(brain: Brain, wanted: boolean): string | undefined {
  const [name, setName] = useState<string>();
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    brain.get<{ name: string }>(`/kids/${KID_ID}/me`).then(
      (me) => live && setName(me.name),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [brain, wanted]);
  return name;
}

function Scene({ page, sprites, speaker }: { page: Page; sprites: Record<string, string>; speaker?: Page["lines"][number] }) {
  const n = page.actors.length;
  const talking = (a: Page["actors"][number]) =>
    !!speaker && speaker.voice !== "kite" && [a.name, a.sprite].some((s) => s?.toLowerCase() === speaker.speaker.toLowerCase());
  return (
    <div className={styles.picture}>
    <div className={styles.scene}>
      <Background bg={page.background} palette={page.palette} cx={0} scale={1} />
      {page.actors.map((a, i) => (
        <figure
          key={i}
          className={styles.actor}
          data-motion={a.motion}
          data-talking={talking(a) || undefined}
          style={{ left: `${((i + 1) / (n + 1)) * 100}%`, bottom: `${GROUND * 100}%` }}
        >
          <img src={resolveSprite(a.sprite, sprites)} alt={a.name ?? a.sprite.replace(/_/g, " ")} />
          {a.name && <figcaption>{a.name}</figcaption>}
        </figure>
      ))}
    </div>
    </div>
  );
}

const THANKS = ["That's a kind idea.", "I like how you think.", "That would help a lot."];

function Ending({ brain, id, book, name, again }: { brain: Brain; id: string; book: Book; name?: string; again: () => void }) {
  const [picked, setPicked] = useState<number>();
  if (book.mode === "bedtime") {
    return (
      <div className={styles.ending}>
        <span className={styles.moon} aria-hidden />
        <p className={styles.goodnight}>{name ? `Goodnight, ${name}` : "Goodnight"}</p>
        <p className={styles.sub}>Sleep tight.</p>
        <Again again={again} />
      </div>
    );
  }
  if (book.check) {
    return (
      <div className={styles.ending}>
        <p className={styles.sub}>The end. Kite has a question for you.</p>
        <Answers brain={brain} id={id} check={book.check} celebrate={() => playSound("cheer")} />
        <Again again={again} />
      </div>
    );
  }
  if (book.reflection) {
    // Never graded and never sent anywhere: any answer is a good one.
    return (
      <div className={styles.ending}>
        <p className={styles.sub}>The end. What do you think?</p>
        <p className={styles.reflect}>{book.reflection.question}</p>
        <div className={styles.thoughts}>
          {book.reflection.choices.map((c, i) => (
            <button key={i} type="button" className={styles.thought} data-picked={picked === i || undefined} onClick={() => setPicked(i)}>
              {c}
            </button>
          ))}
        </div>
        <p className={styles.thanks} role="status">
          {picked !== undefined && THANKS[picked % THANKS.length]}
        </p>
        <Again again={again} />
      </div>
    );
  }
  return (
    <div className={styles.ending}>
      <p className={styles.goodnight}>The end</p>
      <Again again={again} />
    </div>
  );
}

function Again({ again }: { again: () => void }) {
  return (
    <button type="button" className={styles.again} onClick={again}>
      Read it again
    </button>
  );
}

function Icon({ d, fill }: { d: string; fill?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
      <path d={d} fill={fill ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Fixed positions, so the server and the browser draw the same sky.
const STARS = Array.from({ length: 28 }, (_, i) => ({ x: (i * 37 + 11) % 100, y: (i * 53 + 7) % 100, r: 1 + (i % 3), d: (i % 5) * 0.7 }));

function Stars() {
  return (
    <div className={styles.stars} aria-hidden>
      {STARS.map((s, i) => (
        <i key={i} style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.r * 2, height: s.r * 2, animationDelay: `${s.d}s` }} />
      ))}
    </div>
  );
}

export default StoryPlayer;
