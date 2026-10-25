"use client";

import type { Brain, Teachable } from "@kite/client";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import s from "./os.module.css";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

export function TeachPicker({ brain, onPick, onClose }: { brain: Brain; onPick: (t: Teachable) => void; onClose: () => void }) {
  const [list, setList] = useState<readonly Teachable[] | null>(null);
  const [failed, setFailed] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    brain.teachable().then(setList, () => setFailed(true));
  }, [brain]);
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("button")?.focus();
  }, [list]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    <motion.div
      className={s.backdrop}
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: EASE_OUT }}
    >
      <motion.div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="teach-title"
        className={s.picker}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, transform: "scale(0.96)" }}
        animate={{ opacity: 1, transform: "scale(1)" }}
        exit={{ opacity: 0, transform: "scale(0.96)" }}
        transition={{ duration: 0.25, ease: EASE_OUT }}
      >
        <div className={s.pickerHead}>
          <h2 id="teach-title">Teach Kite something</h2>
          <button type="button" className={s.quiet} onClick={onClose}>
            Not now
          </button>
        </div>
        <p className={s.pickerHint}>Pick something you know. Kite will listen to all of it before saying a word.</p>
        {failed && <p className={s.pickerHint}>Kite couldn&apos;t find your topics. Close this and try again.</p>}
        {list && list.length === 0 && (
          <p className={s.pickerHint}>Talk with Kite about something first. Then you can teach it back.</p>
        )}
        {list && list.length > 0 && (
          <ul className={s.topics}>
            {list.map((t) => (
              <li key={t.concept_id}>
                <button type="button" className={s.topic} onClick={() => onPick(t)}>
                  {t.kid_name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </motion.div>
    </motion.div>
  );
}
