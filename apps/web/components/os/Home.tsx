"use client";

import type { DeviceKind } from "@kite/client";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { KiteMark } from "@/components/kit/KiteMark";
import { SPRING, type Band } from "@/lib/band";
import { Glyph, type GlyphName } from "./Glyph";
import s from "./os.module.css";

export type Tile = "talk" | "teach" | "movie" | "game" | "story" | "camera" | "past";

const HELLO: Record<Band, (name: string) => [string, string]> = {
  k2: (n) => [`Hi ${n}!`, "What do you want to do?"],
  g35: (n) => [`Hi ${n}!`, "What are we doing today?"],
  g68: (n) => [`Hey ${n}.`, "Pick something, or just talk."],
  g912: (n) => [`Hey ${n}`, "Talk, teach, or make something."],
};

/** The tiles after Talk, in reading order. Kid words: what she'd say she wants to do. */
const TILES: { tile: Tile | "remember"; glyph: GlyphName; label: string; hint: string; tone: string; handheldOnly?: true }[] = [
  { tile: "teach", glyph: "teach", label: "Teach Kite", hint: "Show Kite what you know", tone: "teach" },
  { tile: "movie", glyph: "movie", label: "Make a movie", hint: "About anything you like", tone: "make" },
  { tile: "game", glyph: "game", label: "Make a game", hint: "Then play it", tone: "make" },
  { tile: "story", glyph: "book", label: "Story time", hint: "Kite tells you a story", tone: "story" },
  { tile: "camera", glyph: "camera", label: "What's this?", hint: "Take a picture and ask", tone: "make", handheldOnly: true },
  { tile: "past", glyph: "chats", label: "Past chats", hint: "What we talked about", tone: "quiet" },
  { tile: "remember", glyph: "remember", label: "What Kite remembers", hint: "The things Kite knows about you", tone: "quiet" },
];

/** Where the kid starts: a greeting, one big way to talk, and the other things Kite does as smaller tiles. */
export function Home({ name, band, device, onOpen }: { name: string | null; band: Band; device: DeviceKind; onOpen: (tile: Tile) => void }) {
  const reduce = useReducedMotion();
  const [hello, nudge] = HELLO[band](name ?? "there");
  const enter = (i: number) => ({
    initial: { opacity: 0, transform: reduce ? "none" : "translateY(10px) scale(0.97)" },
    animate: { opacity: 1, transform: "translateY(0px) scale(1)" },
    transition: { ...SPRING[band], delay: i * 0.05 },
  });
  const tiles = TILES.filter((t) => !t.handheldOnly || device === "handheld");
  return (
    <section className={s.home} aria-label="Home">
      <div className={s.homeHello}>
        <KiteMark size={96} label="Kite" />
        <div>
          <h1 className={s.hello}>{name ? hello : " "}</h1>
          <p className={s.homeNudge}>{nudge}</p>
        </div>
      </div>
      <div className={s.tiles}>
        <motion.button type="button" className={s.talkTile} onClick={() => onOpen("talk")} {...enter(0)}>
          <span className={s.talkTileMark} aria-hidden="true">
            <Glyph name="mic" size={34} />
          </span>
          <span className={s.tileText}>
            <span className={s.tileLabel}>Talk with Kite</span>
            <span className={s.tileHint}>Hold the diamond and ask anything</span>
          </span>
        </motion.button>
        {tiles.map((t, i) => {
          const body = (
            <>
              <span className={s.tileGlyph} aria-hidden="true">
                <Glyph name={t.glyph} size={30} />
              </span>
              <span className={s.tileText}>
                <span className={s.tileLabel}>{t.label}</span>
                <span className={s.tileHint}>{t.hint}</span>
              </span>
            </>
          );
          return (
            <motion.div key={t.tile} className={s.tileCell} {...enter(i + 1)}>
              {t.tile === "remember" ? (
                <Link href="/os/remember" className={s.tile} data-tone={t.tone}>
                  {body}
                </Link>
              ) : (
                <button type="button" className={s.tile} data-tone={t.tone} onClick={() => onOpen(t.tile as Tile)}>
                  {body}
                </button>
              )}
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
