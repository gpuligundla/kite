"use client";

import { Glyph, type GlyphName } from "./Glyph";
import s from "./os.module.css";

export type StoryKind = "fun" | "feelings" | "learn";

/** The kind rides in the ask's words, so the brain's story tool reads it like anything else she says. */
const STORY: Record<StoryKind, { label: string; glyph: GlyphName; ask: (topic: string) => string }> = {
  fun: { label: "Just for fun", glyph: "smile", ask: (t) => `Tell me a funny story about ${t}` },
  feelings: { label: "Feelings & friends", glyph: "remember", ask: (t) => `Tell me a story about ${t} and feelings or friendship` },
  learn: { label: "Learn something", glyph: "bulb", ask: (t) => `Tell me a story that teaches me about ${t}` },
};

export function storyAsk(kind: StoryKind, topic: string, bedtime: boolean): string {
  const text = STORY[kind].ask(topic);
  return bedtime ? text.replace("story", "bedtime story") : text;
}

/** Three big picture-like choices. "Just for fun" starts picked, so a small kid can just hold the diamond and talk. */
export function StoryChoices({ kind, onPick }: { kind: StoryKind; onPick: (kind: StoryKind) => void }) {
  return (
    <div className={s.storyChoices} role="radiogroup" aria-label="What kind of story">
      {(Object.keys(STORY) as StoryKind[]).map((k) => (
        <button key={k} type="button" role="radio" aria-checked={k === kind} className={s.storyChoice} onClick={() => onPick(k)}>
          <span className={s.storyGlyph} aria-hidden="true">
            <Glyph name={STORY[k].glyph} size={30} />
          </span>
          {STORY[k].label}
        </button>
      ))}
    </div>
  );
}

/** A moon switch. On, the stage dims to dusk and the story is asked for as a bedtime story. */
export function BedtimeSwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={s.bedtime} onClick={() => onChange(!on)}>
      <span className={s.moon} aria-hidden="true">
        <Glyph name="moon" size={24} />
      </span>
      Bedtime
    </button>
  );
}
