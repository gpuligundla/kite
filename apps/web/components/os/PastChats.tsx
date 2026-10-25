"use client";

import type { Brain } from "@kite/client";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { KID_ID } from "@/lib/brain";
import { Glyph } from "./Glyph";
import s from "./os.module.css";

/** GET /kids/{kid}/history: her own chats from the last 30 days, newest first. Never levels or scores. */
type PastChat = { id: string; at: string; title: string; turns: { role: "kid" | "kite"; text: string }[] };

const DAY_MS = 86_400_000;
const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

function dayName(at: Date, now: Date): string {
  const days = Math.round((midnight(now) - midnight(at)) / DAY_MS);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return at.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

/** Chats by day, then one chat read back as a plain transcript. Read-only: the stage is where she talks. */
export function PastChats({ brain, onBack }: { brain: Brain; onBack: () => void }) {
  const reduce = useReducedMotion();
  const [chats, setChats] = useState<PastChat[] | "error" | null>(null);
  const [open, setOpen] = useState<PastChat | null>(null);

  useEffect(() => {
    brain.get<PastChat[]>(`/kids/${KID_ID}/history`).then(setChats, () => setChats("error"));
  }, [brain]);

  const enter = {
    initial: { opacity: 0, transform: reduce ? "none" : "translateY(8px)" },
    animate: { opacity: 1, transform: "translateY(0px)" },
    transition: { duration: 0.22, ease: [0.23, 1, 0.32, 1] as const },
  };

  if (open) {
    const at = new Date(open.at);
    return (
      <motion.section key={open.id} className={s.past} aria-label="One past chat" {...enter}>
        <button type="button" className={s.backButton} onClick={() => setOpen(null)}>
          <Glyph name="back" size={20} />
          Back
        </button>
        <h2 className={s.pastTitle}>{open.title}</h2>
        <p className={s.pastWhen}>
          {dayName(at, new Date())}, {at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
        </p>
        <ol className={s.transcript}>
          {open.turns.map((t, i) => (
            <li key={i} data-role={t.role}>
              <span className={s.who}>{t.role === "kid" ? "You" : "Kite"}</span>
              <p>{t.text.replace(/\*\*/g, "")}</p>
            </li>
          ))}
        </ol>
      </motion.section>
    );
  }

  const now = new Date();
  const days = new Map<string, PastChat[]>();
  for (const c of chats instanceof Array ? chats : []) {
    const day = dayName(new Date(c.at), now);
    days.set(day, [...(days.get(day) ?? []), c]);
  }
  return (
    <motion.section className={s.past} aria-label="Past chats" {...enter}>
      <button type="button" className={s.backButton} onClick={onBack}>
        <Glyph name="back" size={20} />
        Back
      </button>
      <h2 className={s.pastTitle}>Past chats</h2>
      {chats === null && <p className={s.pastWhen}>Finding your chats…</p>}
      {chats === "error" && <p className={s.pastWhen}>Kite couldn&apos;t find your chats. Go back and try again.</p>}
      {chats instanceof Array && chats.length === 0 && <p className={s.pastWhen}>No chats yet. Talk with Kite and they&apos;ll show up here.</p>}
      {[...days].map(([day, list]) => (
        <section key={day} className={s.pastDay} aria-label={day}>
          <h3>{day}</h3>
          <ul>
            {list.map((c) => (
              <li key={c.id}>
                <button type="button" className={s.pastChat} onClick={() => setOpen(c)}>
                  <span>{c.title}</span>
                  <span className={s.pastTime}>{new Date(c.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </motion.section>
  );
}
