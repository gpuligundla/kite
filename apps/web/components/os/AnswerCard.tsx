"use client";

import type { DeviceKind, TurnView } from "@kite/client";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import { SPRING, type Band } from "@/lib/band";
import { Glyph } from "./Glyph";
import type { Saying } from "./media";
import s from "./os.module.css";

export interface AnswerCardProps {
  band: Band;
  turn: TurnView;
  /** Which device asked, when the screen knows. */
  asker: DeviceKind | null;
  /** The sentence Kite is saying, for karaoke by sentence. */
  saying: Saying | null;
  /** The movie and game chips, under a finished answer. */
  chips: ReactNode;
}

/**
 * One question and Kite's answer. The whole answer is always on the card; while Kite reads it out, the sentence
 * she's on is marked and the ones still to come wait faintly, so a kid can follow along. No word timings exist.
 */
export function AnswerCard({ band, turn: t, asker, saying, chips }: AnswerCardProps) {
  const reduce = useReducedMotion();
  const now = useRef<HTMLSpanElement>(null);
  const on = saying?.turn === t.id ? saying.index : null;

  useEffect(() => {
    now.current?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [on, reduce]);

  return (
    <motion.section
      className={s.card}
      data-turn={t.id}
      aria-label="Your question and Kite's answer"
      initial={{ opacity: 0, transform: reduce ? "none" : "translateY(12px) scale(0.97)" }}
      animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
      exit={{ opacity: 0, transform: reduce ? "none" : "translateY(-8px) scale(0.98)", transition: { duration: 0.2, ease: [0.23, 1, 0.32, 1] } }}
      transition={SPRING[band]}
    >
      <div className={s.cardTop}>
        {t.heard ? (
          <p className={s.asked}>
            <span>{t.done?.route === "teach" ? "You taught: " : "You asked: "}</span>
            {t.heard}
          </p>
        ) : (
          <span />
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
        <div className={s.answer} aria-live="polite">
          {t.sentences.map((x, i) => (
            <span
              key={i}
              ref={i === on ? now : undefined}
              className={s.sentence}
              data-said={on === null ? undefined : i < on ? "before" : i === on ? "now" : "next"}
            >
              {x.text}{" "}
            </span>
          ))}
        </div>
      ) : (
        !t.done && (
          <div className={s.answer}>
            <Dots label="Kite is thinking" />
          </div>
        )
      )}
      {chips}
    </motion.section>
  );
}

export function Dots({ label }: { label: string }) {
  return (
    <span className={s.dots} role="status" aria-label={label}>
      <i />
      <i />
      <i />
    </span>
  );
}
