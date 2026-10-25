"use client";

import type { Brain } from "@kite/client";
import { useState } from "react";
import { playSound } from "@/lib/sound";
import type { Loaded } from "./CreationCard";
import styles from "./creations.module.css";

type Check = NonNullable<Loaded["storyboard"]>["check"];
type Reply = { correct: boolean; correct_index: number };

const letter = (i: number) => String.fromCharCode(65 + i);

/** The movie's check question, answered once. The letters match the ones the movie draws. */
export function Answers({ brain, id, check, celebrate }: { brain: Brain; id: string; check: Check; celebrate: () => void }) {
  const [picked, setPicked] = useState<number>();
  const [reply, setReply] = useState<Reply>();
  const [failed, setFailed] = useState(false);

  async function pick(choice: number) {
    setPicked(choice);
    setFailed(false);
    try {
      const r = await brain.post<Reply>(`/creations/${id}/answer`, { choice });
      setReply(r);
      if (r.correct) {
        playSound("correct");
        setTimeout(celebrate, 250); // the cheer lands just after the chime instead of on top of it
      } else {
        playSound("oops");
      }
    } catch {
      setPicked(undefined);
      setFailed(true);
    }
  }

  const stateOf = (i: number) => {
    if (!reply) return picked === i ? "waiting" : "idle";
    if (i === reply.correct_index) return "right";
    return i === picked ? "missed" : "dim";
  };

  return (
    <section className={styles.ask} aria-label="Kite's question">
      <p className={styles.question}>{check.question}</p>
      <div className={styles.choices}>
        {check.choices.map((c, i) => (
          <button
            key={i}
            type="button"
            className={styles.choice}
            data-state={stateOf(i)}
            disabled={picked !== undefined}
            onClick={() => pick(i)}
          >
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
    </section>
  );
}
