"use client";

import type { Brain } from "@kite/client";
import { useEffect, useRef } from "react";
import { playSound, setVoiceActive } from "@/lib/sound";
import type { Loaded } from "./CreationCard";
import styles from "./creations.module.css";

type Check = NonNullable<Loaded["storyboard"]>["check"];
type Reply = { correct: boolean; correct_index: number };
/** The kid's answer. The card keeps it, so the question is asked once however many times the movie plays. */
export type Answer = { picked?: number; reply?: Reply; failed?: boolean };

const letter = (i: number) => String.fromCharCode(65 + i);

/** The movie's check question, laid over the paused picture. Kite reads it aloud when the brain recorded it. */
export function CheckCard({
  brain,
  id,
  check,
  voice,
  answer,
  setAnswer,
  celebrate,
  again,
  close,
  againLabel = "Watch again",
}: {
  brain: Brain;
  id: string;
  check: Check;
  voice: string | undefined;
  answer: Answer;
  setAnswer: (a: Answer) => void;
  celebrate: () => void;
  again: () => void;
  /** Left out where the surrounding player has its own way out (a storybook). */
  close?: () => void;
  againLabel?: string;
}) {
  const root = useRef<HTMLElement>(null);
  const speaking = useRef<HTMLAudioElement | null>(null);
  const { picked, reply, failed } = answer;

  useEffect(() => {
    // Focus follows the question only when it was already in this player, never away from the kid's typing.
    if (root.current?.closest("dialog")?.contains(document.activeElement)) root.current.querySelector("button")?.focus();
    if (!voice || reply) return;
    const a = new Audio(voice);
    speaking.current = a;
    const quiet = () => setVoiceActive(false);
    a.addEventListener("ended", quiet);
    a.addEventListener("error", quiet);
    setVoiceActive(true);
    a.play().catch(quiet);
    return () => {
      a.pause();
      quiet();
    };
    // Once each time the question comes up.
  }, []);

  async function pick(choice: number) {
    // Kite stops reading so the chime isn't held back behind her voice.
    speaking.current?.pause();
    setVoiceActive(false);
    setAnswer({ picked: choice });
    try {
      const r = await brain.post<Reply>(`/creations/${id}/answer`, { choice });
      setAnswer({ picked: choice, reply: r });
      if (r.correct) {
        playSound("correct");
        setTimeout(celebrate, 250); // the cheer lands just after the chime instead of on top of it
      } else {
        playSound("oops");
      }
    } catch {
      setAnswer({ failed: true });
    }
  }

  const stateOf = (i: number) => {
    if (!reply) return picked === i ? "waiting" : "idle";
    if (i === reply.correct_index) return "right";
    return i === picked ? "missed" : "dim";
  };

  return (
    <section ref={root} className={styles.check} aria-label="Kite's question">
      <div className={styles.checkCard}>
        <p className={styles.question}>{check.question}</p>
        <div className={styles.choices}>
          {check.choices.map((c, i) => (
            <button key={i} type="button" className={styles.choice} data-state={stateOf(i)} disabled={picked !== undefined} onClick={() => pick(i)}>
              <span className={styles.letter}>{letter(i)}</span>
              {c}
            </button>
          ))}
        </div>
        <p className={styles.verdict} role="status" data-right={reply?.correct || undefined}>
          {reply?.correct && "That's right!"}
          {reply && !reply.correct && `Good try. The answer is ${letter(reply.correct_index)}: ${check.choices[reply.correct_index]}`}
          {failed && "Kite didn't hear that. Tap your answer again."}
        </p>
        {reply && (
          <div className={styles.actions}>
            <button type="button" className={styles.action} onClick={again}>
              {againLabel}
            </button>
            {close && (
              <button type="button" className={`${styles.action} ${styles.actionWarm}`} onClick={close}>
                Close
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
