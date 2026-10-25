import type { DashboardView, Grade, KiteEvent } from "@kite/client";
import type { components } from "../../../../packages/client/src/contract";
// ponytail: the dashboard sends concept ids without their topic or grade, so the catalog is read here.
// Drop this import once ConceptLevel carries `topic` and `grade` (or DashboardView carries strength_topics).
import catalog from "../../../../brain/kite_brain/concepts.json";

export type { DashboardView, Grade };
export type Alert = DashboardView["alerts"][number];
export type AlertKind = Alert["kinds"][number];
export type Card = DashboardView["cards"][number];
export type Concept = DashboardView["skills"]["concepts"][number];
export type Level = Concept["level"];
export type PolicyAction = DashboardView["policy"][string];
export type CounselorAlert = components["schemas"]["CounselorAlertView"];
export type Contact = components["schemas"]["ContactView"];
export type Creation = components["schemas"]["Creation"];
export type AlertEvent = Extract<KiteEvent, { type: "alert" }>;

/** From brain/kite_brain/seed.py. The dashboard has no name, current grade or family id yet. */
export const KID = { name: "Maya", grade: 11 as Grade, family: "rivera", firstGrade: 1 as Grade };

const CONCEPTS = new Map(catalog.map((c) => [c.id, c]));

const TOPIC_NAMES: Record<string, string> = {
  area_perimeter: "Area and perimeter",
  earth_space: "Earth and space",
  cells_genetics: "Cells and genetics",
};
export const topicName = (topic: string) =>
  TOPIC_NAMES[topic] ?? topic.charAt(0).toUpperCase() + topic.slice(1).replaceAll("_", " ");

export const LEVELS: readonly Level[] = ["not_yet", "learning", "got_it", "can_teach"];
export const LEVEL_WORDS: Record<Level, string> = {
  not_yet: "Not yet",
  learning: "Learning",
  got_it: "Got it",
  can_teach: "Can teach it",
};
const solid = (level: Level) => level === "got_it" || level === "can_teach";

export interface Topic {
  topic: string;
  name: string;
  /** Oldest catalog grade first. */
  concepts: Concept[];
  solid: number;
}

/** Every evidenced concept, grouped by its catalog topic, biggest topic first. */
export function skillsByTopic(view: DashboardView): Topic[] {
  const groups = new Map<string, Concept[]>();
  for (const c of view.skills.concepts) {
    const topic = CONCEPTS.get(c.concept_id)?.topic ?? "other";
    groups.set(topic, [...(groups.get(topic) ?? []), c]);
  }
  const gradeOf = (c: Concept) => CONCEPTS.get(c.concept_id)?.grade ?? 99;
  return [...groups]
    .map(([topic, concepts]) => ({
      topic,
      name: topicName(topic),
      concepts: concepts.sort((a, b) => gradeOf(a) - gradeOf(b)),
      solid: concepts.filter((c) => solid(c.level)).length,
    }))
    .sort((a, b) => b.concepts.length - a.concepts.length || a.name.localeCompare(b.name));
}

// The brain's bar for "she asks about it a lot" (maps.py: top 3 curiosity topics scoring 0.6 or more).
// The strength verdict itself comes from DashboardView.strengths; these only pick who is "getting there".
const TOP_CURIOSITY = 3;
const CURIOUS_SCORE = 0.6;

export interface Standing {
  topic: string;
  name: string;
  strength: boolean;
  solid: number;
  /** Evidenced concepts at or below the viewed grade, the ones the strength rule counts. */
  total: number;
  /** Names of the concepts that aren't solid yet. */
  unsettled: string[];
}

/** Her strength topics, then the topics she asks about most that aren't strengths yet. */
export function standings(view: DashboardView, grade: Grade): Standing[] {
  const strengths = view.strengths ?? [];
  const curious = view.curiosity.topics.slice(0, TOP_CURIOSITY).filter((t) => t.score >= CURIOUS_SCORE).map((t) => t.topic);
  return [...new Set([...strengths, ...curious])].map((topic) => {
    const concepts = view.skills.concepts.filter((c) => {
      const k = CONCEPTS.get(c.concept_id);
      return k?.topic === topic && k.grade <= grade;
    });
    return {
      topic,
      name: topicName(topic),
      strength: strengths.includes(topic),
      solid: concepts.filter((c) => solid(c.level)).length,
      total: concepts.length,
      unsettled: concepts.filter((c) => !solid(c.level)).map((c) => c.name),
    };
  });
}

/** Growing areas (below "got it" across 2+ sessions), grouped by topic. */
export function growing(view: DashboardView): { name: string; concepts: string[] }[] {
  const names = new Map(view.skills.concepts.map((c) => [c.concept_id, c.name]));
  const groups = new Map<string, string[]>();
  for (const id of view.skills.growing) {
    const topic = topicName(CONCEPTS.get(id)?.topic ?? "other");
    groups.set(topic, [...(groups.get(topic) ?? []), names.get(id) ?? CONCEPTS.get(id)?.name ?? id]);
  }
  return [...groups].map(([name, concepts]) => ({ name, concepts }));
}

export interface CuriosityYears {
  /** The three topics with the biggest share across the years shown, in slot order. */
  series: { topic: string; name: string }[];
  rows: { grade: number; shares: number[]; other: number }[];
}

/**
 * Each grade's share of her curiosity per topic. The brain's by_grade values are decayed from the
 * viewed grade's year end; within one grade every topic decays alike, so the per-grade share undoes it.
 */
export function curiosityYears(view: DashboardView): CuriosityYears {
  const grades = [...new Set(view.curiosity.topics.flatMap((t) => Object.keys(t.by_grade).map(Number)))].sort((a, b) => a - b);
  const totals = new Map(grades.map((g) => [g, view.curiosity.topics.reduce((s, t) => s + (t.by_grade[g] ?? 0), 0)]));
  const share = (topic: (typeof view.curiosity.topics)[number], g: number) => (topic.by_grade[g] ?? 0) / (totals.get(g) || 1);
  const top = [...view.curiosity.topics]
    .map((t) => ({ t, sum: grades.reduce((s, g) => s + share(t, g), 0) }))
    .sort((a, b) => b.sum - a.sum)
    .slice(0, 3)
    .map(({ t }) => t);
  return {
    series: top.map((t) => ({ topic: t.topic, name: topicName(t.topic) })),
    rows: grades.map((g) => {
      const shares = top.map((t) => share(t, g));
      return { grade: g, shares, other: Math.max(0, 1 - shares.reduce((a, b) => a + b, 0)) };
    }),
  };
}

export const HOW_SHE_LEARNS: Record<string, string> = {
  teach_back: "teaching it back to Kite",
  check_question: "a check question after a movie",
  game: "playing a game",
};

const KIND_WORDS: Record<AlertKind, string> = {
  sos: "SOS",
  bullying: "Bullying",
  stranger: "A stranger",
  abuse: "Possible abuse",
  self_harm: "Self-harm",
};
export const kindWords = (kinds: AlertKind[]) => kinds.map((k) => KIND_WORDS[k]).join(" and ");

export const POLICY_TOPICS: { topic: string; name: string }[] = [
  { topic: "death", name: "Death and dying" },
  { topic: "religion", name: "Religion and beliefs" },
  { topic: "bodies", name: "Bodies and growing up" },
  { topic: "war", name: "War and violence" },
  { topic: "divorce", name: "Divorce and family changes" },
];
export const POLICY_ACTIONS: { action: PolicyAction; label: string; detail: string }[] = [
  { action: "answer", label: "Answer", detail: "Kite answers at her level." },
  { action: "answer_and_tell", label: "Answer and tell me", detail: "Kite answers, and you get a card with a conversation starter." },
  { action: "ask_parent", label: "Ask me first", detail: "Kite asks her to bring it to you, and you get a card." },
];

const when = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const month = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
export const formatWhen = (iso: string) => when.format(new Date(iso));
export const formatMonth = (iso: string) => month.format(new Date(iso));

/** Card summaries are the start of Kite's answer, markdown and all, cut at 300 characters. */
export const plainSummary = (s: string) => {
  const text = s.replace(/\*\*|__|^#+\s*/gm, "").replace(/\s+/g, " ").trim();
  return s.length >= 300 ? `${text.replace(/\s+\S*$/, "")}…` : text;
};

/** Moments are written to the kid ("You taught Kite about…"); the parent reads them about her. */
export const momentForParent = (m: string) => m.replace(/^You taught Kite about/, "Taught Kite about");

export const mapUrl = (lat: number, lng: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;

export const percent = (x: number) => `${Math.round(x * 100)}%`;
