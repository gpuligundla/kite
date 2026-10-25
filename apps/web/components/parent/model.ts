import type { DashboardView, Grade } from "@kite/client";
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
export type Contact = components["schemas"]["ContactView"];
export type Creation = components["schemas"]["Creation"];

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

/** One idea in the knowledge map. `level` is null for an idea in the topic she hasn't shown Kite yet. */
export interface Cell {
  id: string;
  name: string;
  grade: number;
  level: Level | null;
  /** Axial hex coordinates inside its comb, a pure function of the catalog so a cell never moves between grades. */
  q: number;
  r: number;
}
export interface Comb {
  topic: string;
  name: string;
  strength: boolean;
  cells: Cell[];
  solid: number;
  shown: number;
}

// Axial directions for pointy-top hexes, walked as a spiral: center, then ring 1, ring 2, ...
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]] as const;
const SPIRAL: [number, number][] = [[0, 0]];
for (let k = 1; k <= 3; k++) {
  let [q, r] = [DIRS[4][0] * k, DIRS[4][1] * k];
  for (const [dq, dr] of DIRS)
    for (let j = 0; j < k; j++) {
      SPIRAL.push([q, r]);
      [q, r] = [q + dq, r + dr];
    }
}

const TOPIC_CATALOG = new Map<string, typeof catalog>();
for (const c of [...catalog].sort((a, b) => a.grade - b.grade || a.id.localeCompare(b.id)))
  TOPIC_CATALOG.set(c.topic, [...(TOPIC_CATALOG.get(c.topic) ?? []), c]);

/**
 * Every topic she has shown Kite anything in, as a comb holding the topic's whole catalog: earliest idea at the
 * center, later ones spiralling out. Combs keep a fixed order (biggest topic first) so the map only fills in.
 */
export function knowledgeMap(view: DashboardView): Comb[] {
  const levels = new Map(view.skills.concepts.map((c) => [c.concept_id, c.level]));
  const strengths = new Set(view.strengths ?? []);
  const topics = new Set(view.skills.concepts.map((c) => CONCEPTS.get(c.concept_id)?.topic).filter((t) => t !== undefined));
  return [...topics]
    .map((topic) => {
      const cells = TOPIC_CATALOG.get(topic)!.map((c, i) => ({
        id: c.id, name: c.name, grade: c.grade, level: levels.get(c.id) ?? null, q: SPIRAL[i][0], r: SPIRAL[i][1],
      }));
      return {
        topic,
        name: topicName(topic),
        strength: strengths.has(topic),
        cells,
        solid: cells.filter((c) => c.level && solid(c.level)).length,
        shown: cells.filter((c) => c.level).length,
      };
    })
    .sort((a, b) => b.cells.length - a.cells.length || a.name.localeCompare(b.name));
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
  /** The biggest topics across the years shown, biggest first. The rest fold into "Other". */
  topics: { topic: string; name: string }[];
  /** One row per grade up to the viewed one: each topic's share of that year's curiosity, then Other's. */
  years: { grade: number; shares: number[] }[];
}

const YEAR_TOPICS = 4;

/**
 * Each topic's share of her curiosity, year by year. The brain's by_grade values are decayed from the viewed grade's
 * year end; within one grade every topic decays alike, so the per-grade share undoes it.
 */
export function curiosityYears(view: DashboardView, grade: number): CuriosityYears {
  const all = view.curiosity.topics;
  const years = Array.from({ length: grade }, (_, i) => i + 1).map((g) => {
    const total = all.reduce((s, t) => s + (t.by_grade[g] ?? 0), 0);
    return { grade: g, total, share: (topic: string) => (total ? (all.find((t) => t.topic === topic)?.by_grade[g] ?? 0) / total : 0) };
  });
  const weight = (topic: string) => years.reduce((s, y) => s + y.share(topic), 0);
  const top = all.map((t) => t.topic).filter((t) => weight(t) > 0).sort((a, b) => weight(b) - weight(a)).slice(0, YEAR_TOPICS);
  return {
    topics: top.map((topic) => ({ topic, name: topicName(topic) })),
    years: years
      .filter((y) => y.total > 0)
      .map((y) => {
        const shares = top.map(y.share);
        return { grade: y.grade, shares: [...shares, Math.max(0, 1 - shares.reduce((a, b) => a + b, 0))] };
      }),
  };
}

export interface Year {
  grade: number;
  figured: string[];
  taught: string[];
}

const FIGURED = "Figured out ";
const TAUGHT = "You taught Kite about ";

// A moment names its idea mid-sentence ("the math of the blue sky"); listed on its own, the idea leads with a capital.
const idea = (m: string, prefix: string) => m.charAt(prefix.length).toUpperCase() + m.slice(prefix.length + 1);

/** Moments by school year, newest first, split into ideas she figured out and ideas she taught Kite. */
export function momentYears(view: DashboardView): Year[] {
  return Object.entries(view.moments_by_grade)
    .map(([g, items]) => ({
      grade: Number(g),
      figured: items.filter((m) => m.startsWith(FIGURED)).map((m) => idea(m, FIGURED)),
      taught: items.filter((m) => m.startsWith(TAUGHT)).map((m) => idea(m, TAUGHT)),
    }))
    .sort((a, b) => b.grade - a.grade);
}

export const STYLE_WORDS: Record<string, string> = {
  explain: "Explanations",
  hands_on: "Hands-on",
  picture: "Pictures",
  game: "Games",
  story: "Stories",
};

/** The hero's facts, all as of the end of the viewed grade. */
export function portrait(view: DashboardView) {
  const concepts = view.skills.concepts;
  return {
    curious: view.curiosity.topics[0] ? topicName(view.curiosity.topics[0].topic) : null,
    solid: concepts.filter((c) => solid(c.level)).length,
    shown: concepts.length,
    canTeach: view.skills.can_teach.length,
  };
}

export interface Happening {
  key: string;
  kind: "alert" | "card" | "moment";
  text: string;
  at?: string;
}

const WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * What's new. At her current grade: this week's alerts and big questions, else the latest of each, plus her newest
 * moment. At a past grade: that year's moments. Moments carry no date, so they're never called "this week".
 */
export function lately(view: DashboardView, grade: Grade, current: boolean, alerts: Alert[], now: number) {
  const moments = (view.moments_by_grade[grade] ?? []).map(momentForParent);
  if (!current) {
    const asked = view.cards.filter((c) => c.grade === grade).length;
    return {
      title: `In grade ${grade}`,
      items: [
        ...moments.slice(-3).reverse().map((text, i): Happening => ({ key: `m${i}`, kind: "moment", text })),
        ...(asked ? [{ key: "cards", kind: "card", text: `Asked ${asked === 1 ? "one big question" : `${asked} big questions`}` } as Happening] : []),
      ],
    };
  }
  const recent = <T extends { at: string }>(xs: T[]) => xs.filter((x) => now - Date.parse(x.at) < WEEK);
  const week = { alerts: recent(alerts), cards: recent(view.cards) };
  const thisWeek = week.alerts.length + week.cards.length > 0;
  const shownAlerts = thisWeek ? week.alerts : alerts.slice(0, 1);
  const shownCards = thisWeek ? week.cards : view.cards.slice(0, 1);
  const byKind = new Map<string, Alert[]>();
  for (const a of shownAlerts) byKind.set(kindWords(a.kinds), [...(byKind.get(kindWords(a.kinds)) ?? []), a]);
  const byTopic = new Map<string, Card[]>();
  for (const c of shownCards) byTopic.set(c.topic, [...(byTopic.get(c.topic) ?? []), c]);
  const times = (n: number) => (n === 1 ? "" : n === 2 ? " twice" : ` ${n} times`);
  return {
    title: thisWeek ? "This week" : "Lately",
    items: [
      ...[...byKind].map(([word, list]): Happening => ({
        key: `a-${word}`, kind: "alert", at: list[0].at,
        text: word === "SOS" ? `Pressed SOS${times(list.length)}` : `${word} alert${list.length > 1 ? `, ${list.length} times` : ""}`,
      })),
      ...[...byTopic].map(([topic, list]): Happening => ({
        key: `c-${topic}`, kind: "card", at: list[0].at, text: `Asked about ${topicName(topic).toLowerCase()}${times(list.length)}`,
      })),
      ...moments.slice(-1).map((text): Happening => ({ key: "m", kind: "moment", text })),
    ],
  };
}

export const HOW_SHE_LEARNS: Record<string, string> = {
  teach_back: "teaching it back to Kite",
  check_question: "a check question after a movie",
  game: "playing a game",
};

export type Tone = "urgent" | "care" | "heads_up";

/**
 * What a grown-up reads for each kind, most pressing first: an alert with several kinds leads with the earliest here.
 * The parent never gets the kid's words, so `title` says what kind of thing happened and `next` what to do about it.
 */
export const ALERT_KINDS: Record<AlertKind, { word: string; tone: Tone; title: (name: string) => string; next: string }> = {
  sos: {
    word: "SOS",
    tone: "urgent",
    title: (name) => `${name} pressed SOS on her phone.`,
    next: "Call her first. If you can't reach her and think she's in danger, call 911.",
  },
  self_harm: {
    word: "Self-harm",
    tone: "care",
    title: (name) => `Something ${name} said to Kite sounded like she may want to hurt herself.`,
    next: "Check in with her today, somewhere calm, and listen first. If you think she's in danger now, call or text 988.",
  },
  abuse: {
    word: "Possible abuse",
    tone: "care",
    title: (name) => `Something ${name} said to Kite may mean someone is hurting her.`,
    next: "Talk with her somewhere she feels safe, and listen before you act.",
  },
  bullying: {
    word: "Bullying",
    tone: "heads_up",
    title: (name) => `Something ${name} told Kite sounded like bullying.`,
    next: "Ask how things are with friends and at school, and listen before you act.",
  },
  stranger: {
    word: "A stranger",
    tone: "heads_up",
    title: (name) => `${name} mentioned talking with someone she doesn't know.`,
    next: "Ask who she's been talking to, online or nearby, without blame.",
  },
};
const KIND_ORDER = Object.keys(ALERT_KINDS) as AlertKind[];
export const leadKind = (kinds: AlertKind[]) => KIND_ORDER.find((k) => kinds.includes(k)) ?? kinds[0];
export const kindWords = (kinds: AlertKind[]) => kinds.map((k) => ALERT_KINDS[k].word).join(" and ");

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
export const formatWhen = (iso: string) => when.format(new Date(iso));

/**
 * Card summaries are the start of Kite's answer, cut at 300 characters, and older cards still carry markdown. The cut
 * can land mid-word after the brain strips the markdown, so any summary that doesn't end a sentence was cut.
 */
export const plainSummary = (s: string) => {
  const text = s.replace(/\*\*|__|^#+\s*/gm, "").replace(/\s+/g, " ").trim();
  return /[.!?…"”')\]\p{Extended_Pictographic}]$/u.test(text) ? text : `${text.replace(/[\s,;:]+\S*$/, "")}…`;
};

/** Moments are written to the kid ("You taught Kite about…"); the parent reads them about her. */
const momentForParent = (m: string) => m.replace(/^You taught Kite about/, "Taught Kite about");

export const mapUrl = (lat: number, lng: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
export const formatPlace = (lat: number, lng: number) =>
  `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? "E" : "W"}`;

const MAP_ZOOM = 15;
/** The 3×3 OpenStreetMap tiles around a point, each offset in pixels from the point itself. */
export function tilesAround(lat: number, lng: number) {
  const n = 2 ** MAP_ZOOM;
  const rad = (lat * Math.PI) / 180;
  const x = ((lng + 180) / 360) * n;
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  return [-1, 0, 1].flatMap((dy) =>
    [-1, 0, 1].map((dx) => {
      const [tx, ty] = [Math.floor(x) + dx, Math.floor(y) + dy];
      return { url: `https://tile.openstreetmap.org/${MAP_ZOOM}/${tx}/${ty}.png`, left: (tx - x) * 256, top: (ty - y) * 256 };
    }),
  );
}

const rtf = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
export function ago(iso: string, now: number) {
  const min = Math.round((now - Date.parse(iso)) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return rtf.format(-min, "minute");
  if (min < 24 * 60) return rtf.format(-Math.round(min / 60), "hour");
  return rtf.format(-Math.round(min / (24 * 60)), "day");
}

export const percent = (x: number) => `${Math.round(x * 100)}%`;
