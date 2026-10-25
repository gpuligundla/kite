"use client";

import type { Brain } from "@kite/client";
import { CreationCard } from "@/components/creations/CreationCard";
import { Glyph } from "@/components/os/Glyph";
import type { MadeThing } from "./classroom";
import s from "./shell.module.css";

const VERB = { movie: "Watch", game: "Play", story: "Read" } as const;

/** Everything she made with Kite, newest first. One opens in the creation card the Kite app uses. */
export function CreationsApp({ brain, made, open, onOpen }: {
  brain: Brain;
  made: MadeThing[] | null;
  open: MadeThing | null;
  onOpen: (m: MadeThing) => void;
}) {
  if (open) {
    return (
      <div className={s.player}>
        <CreationCard brain={brain} creation={{ id: open.id, kind: open.kind, status: "ready" }} />
      </div>
    );
  }
  if (made === null) return <p className={s.quietLine}>Finding what you made…</p>;
  if (made.length === 0) return <p className={s.quietLine}>Nothing yet. Ask Kite to make a movie, a game or a story.</p>;
  return (
    <ul className={s.gallery}>
      {made.map((m) => (
        <li key={m.id}>
          <button type="button" className={s.made} data-kind={m.kind} onClick={() => onOpen(m)}>
            <span className={s.madeArt} data-kind={m.kind} style={{ filter: `hue-rotate(${(parseInt(m.id.slice(0, 2), 16) % 5) * 18 - 36}deg)` }} aria-hidden="true">
              <Glyph name={m.kind === "story" ? "book" : m.kind} size={40} />
            </span>
            <strong>{m.title}</strong>
            <span>
              {VERB[m.kind]} your {m.kind}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
