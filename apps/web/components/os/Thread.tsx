"use client";

import { NO_TURN, type Brain, type DeviceKind, type TurnView } from "@kite/client";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import { CreationCard } from "@/components/creations/CreationCard";
import { SPRING, type Band } from "@/lib/band";
import type { CreationEntry, CreationKind, Creations } from "@/lib/creations";
import { Glyph } from "./Glyph";
import s from "./os.module.css";

export interface ThreadProps {
  brain: Brain;
  band: Band;
  device: DeviceKind;
  turns: readonly TurnView[];
  /** Turns replayed from before this page opened. */
  earlier: ReadonlySet<string>;
  creations: Creations;
  /** creation id to the turn it shows under. A creation with no anchor started before this page opened and isn't shown. */
  anchors: Readonly<Record<string, string>>;
  /** `${turn id}:${kind}` for each chip already pressed. */
  making: ReadonlySet<string>;
  onMake: (turn: TurnView, kind: CreationKind) => void;
  empty: ReactNode;
}

const TOP_GAP = 16;

const MAKE: Record<CreationKind, { label: string; busy: string }> = {
  movie: { label: "Make it a movie", busy: "Making your movie" },
  game: { label: "Make a game", busy: "Making your game" },
};

export function Thread({ brain, band, device, turns, earlier, creations, anchors, making, onMake, empty }: ThreadProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const follow = useRef<"turn" | "bottom" | "off">("turn");
  const reduce = useReducedMotion();
  const shown = turns.filter((t) => t.id !== NO_TURN && (t.mine || t.heard || t.sentences.length > 0));

  // A new turn scrolls into view and is followed while it streams, but a long answer stops at its first line so the
  // kid reads it from the start while Kite says it. Scrolled to the bottom by hand, the thread follows the bottom;
  // scrolled anywhere else, it stays put.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !column.current) return;
    let ours = -1;
    const onScroll = () => {
      if (Math.abs(el.scrollTop - ours) < 2) return;
      follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96 ? "bottom" : "off";
    };
    const observer = new ResizeObserver(() => {
      if (follow.current === "off") return;
      const latest = column.current?.lastElementChild;
      const bottom = el.scrollHeight - el.clientHeight;
      el.scrollTop = follow.current === "turn" && latest instanceof HTMLElement ? Math.min(bottom, latest.offsetTop - TOP_GAP) : bottom;
      ours = el.scrollTop;
    });
    el.addEventListener("scroll", onScroll, { passive: true });
    observer.observe(column.current);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, []);
  useEffect(() => {
    follow.current = "turn";
  }, [shown.length]);

  const enter = {
    initial: { opacity: 0, transform: reduce ? "none" : "translateY(10px) scale(0.97)" },
    animate: { opacity: 1, transform: "translateY(0px) scale(1)" },
    transition: SPRING[band],
  };
  const card = (c: CreationEntry) => (
    <motion.div key={c.id} className={s.creation} {...enter}>
      <CreationCard brain={brain} creation={c} />
    </motion.div>
  );

  return (
    <div className={s.thread} ref={scroller}>
      <div className={s.column} ref={column}>
        {shown.length === 0 && empty}
        {shown.map((t) => {
          // The wire doesn't say which device asked. A live turn not posted here came from the kid's other device.
          const asker: DeviceKind | null = t.mine ? device : earlier.has(t.id) ? null : device === "os" ? "handheld" : "os";
          const first = t.sentences[0]?.text;
          const canMake = t.done?.route === "answer" && t.heard && first;
          const below = creations.filter((c) => anchors[c.id] === t.id);
          return (
            <section key={t.id} className={s.turn} aria-label="One question and Kite's answer">
              {/* The reading level sits across from the question, so it shows with the answer's first line and never
                  pushes the answer down when it arrives. */}
              <div className={s.askRow}>
                {(t.heard || (t.mine && t.heard === undefined)) && (
                  <motion.p className={s.you} {...enter}>
                    {t.heard || <Dots label="Kite is listening" />}
                  </motion.p>
                )}
                {t.done && (
                  <div className={s.meta}>
                    {t.done.fkGrade !== null && (
                      <span className={s.fk} title="How hard this answer is to read, as a school grade">
                        FK {t.done.fkGrade.toFixed(1)}
                      </span>
                    )}
                    {t.done.deeper && (
                      <span className={s.deeper} title="Kite went deeper because you love this topic">
                        <Glyph name="deeper" size={14} /> Deeper
                      </span>
                    )}
                    {asker && (
                      <span className={s.device}>
                        <Glyph name={asker === "os" ? "computer" : "phone"} size={16} />
                        {t.mine ? "Asked here" : asker === "handheld" ? "Asked on your phone" : "Asked on the computer"}
                      </span>
                    )}
                  </div>
                )}
              </div>
              {t.sentences.length > 0 ? (
                <motion.div className={s.answer} {...enter} aria-live="polite">
                  {t.sentences.map((x, i) => (
                    <span key={i} className={s.sentence}>
                      {x.text}{" "}
                    </span>
                  ))}
                </motion.div>
              ) : (
                !t.done && (
                  <motion.div className={`${s.answer} ${s.thinking}`} {...enter}>
                    <Dots label="Kite is thinking" />
                  </motion.div>
                )
              )}
              {canMake && (
                <div className={s.makes}>
                  {(["movie", "game"] as const).filter((kind) => !below.some((c) => c.kind === kind)).map((kind) => {
                    const busy = making.has(`${t.id}:${kind}`);
                    return (
                      <button key={kind} type="button" className={s.make} disabled={busy} onClick={() => onMake(t, kind)}>
                        <Glyph name={kind} size={18} />
                        {busy ? MAKE[kind].busy : MAKE[kind].label}
                      </button>
                    );
                  })}
                </div>
              )}
              {below.map(card)}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Dots({ label }: { label: string }) {
  return (
    <span className={s.dots} role="status" aria-label={label}>
      <i />
      <i />
      <i />
    </span>
  );
}
