"use client";

import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { CuriosityChart } from "./CuriosityChart";
import { SkillsMap } from "./SkillsMap";
import {
  HOW_SHE_LEARNS, KID, formatMonth, growing, momentForParent, percent, plainSummary, standings, topicName,
  type DashboardView, type Grade, type Standing,
} from "./model";
import styles from "./parent.module.css";

/** Everything here is as of the end of `grade`. `stale` holds the last render dimmed while the next grade loads. */
export function Overview({ view, grade, stale }: { view: DashboardView; grade: Grade; stale: boolean }) {
  return (
    <div className={styles.overview} data-stale={stale}>
      <Standings view={view} grade={grade} />
      <div className={styles.pair}>
        <CuriosityChart view={view} grade={grade} />
        <HowSheLearns shares={view.how_she_learns} />
      </div>
      <SkillsMap view={view} />
      <div className={styles.pair}>
        <Cards cards={view.cards} />
        <Moments moments={view.moments_by_grade} />
      </div>
    </div>
  );
}

function Standings({ view, grade }: { view: DashboardView; grade: Grade }) {
  const reduce = useReducedMotion();
  const all = standings(view, grade);
  const groups = [
    { title: "Strengths", items: all.filter((s) => s.strength), empty: "None yet at this grade." },
    { title: "Getting there", items: all.filter((s) => !s.strength), empty: "Nothing close right now." },
  ];
  const still = growing(view);
  return (
    <section className={styles.section} aria-labelledby="standing-h">
      <h2 id="standing-h">Where {KID.name} is strong</h2>
      <p className={styles.lede}>
        A strength is a topic she asks about often where at least 3 in 4 of the ideas she&apos;s shown Kite are solid.
      </p>
      <LayoutGroup>
        <div className={styles.standings}>
          {groups.map((g) => (
            <div key={g.title}>
              <h3>{g.title}</h3>
              <ul className={styles.plainList}>
                {g.items.map((s) => (
                  <motion.li
                    key={s.topic}
                    layoutId={`standing-${s.topic}`}
                    layout={reduce ? false : "position"}
                    layoutDependency={grade}
                    transition={{ duration: 0.26, ease: [0.77, 0, 0.175, 1] }}
                    className={styles.standing}
                    data-strength={s.strength}
                  >
                    <strong>{s.name}</strong>
                    <span>{standingLine(s)}</span>
                  </motion.li>
                ))}
                {g.items.length === 0 && <li className={styles.quiet}>{g.empty}</li>}
              </ul>
            </div>
          ))}
          <div>
            <h3>Still growing</h3>
            <ul className={styles.plainList}>
              {still.map((t) => (
                <li key={t.name} className={styles.standing}>
                  <strong>{t.name}</strong>
                  <span>
                    She has worked on {list(t.concepts.map(quote))} across several sessions.{" "}
                    {t.concepts.length > 1 ? "They aren't solid yet." : "It isn't solid yet."}
                  </span>
                </li>
              ))}
              {still.length === 0 && <li className={styles.quiet}>Nothing stuck right now.</li>}
            </ul>
          </div>
        </div>
      </LayoutGroup>
    </section>
  );
}

function standingLine(s: Standing): string {
  const solid = `${s.solid} of ${s.total} ideas solid`;
  if (s.strength) return `${solid}, and one of the things she asks about most.`;
  const settling = s.unsettled.length ? ` Still settling: ${list(s.unsettled.map(quote))}.` : "";
  return `She asks about it a lot. ${solid}; a strength needs 3 in 4.${settling}`;
}

const list = (xs: string[]) => new Intl.ListFormat("en-US").format(xs);
const quote = (s: string) => `\u201c${s}\u201d`;

function HowSheLearns({ shares }: { shares: DashboardView["how_she_learns"] }) {
  const rows = Object.entries(shares ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <section className={styles.section} aria-labelledby="learns-h">
      <h2 id="learns-h">How she learns</h2>
      <p className={styles.lede}>For each way she first met an idea, how many of those ideas are solid now.</p>
      {rows.length === 0 && <p className={styles.quiet}>Not enough to tell yet.</p>}
      <ul className={styles.plainList}>
        {rows.map(([mode, share]) => (
          <li key={mode} className={styles.meterRow}>
            <span className={styles.meterValue}>{percent(share)}</span>
            <span className={styles.meter} aria-hidden>
              <span style={{ transform: `scaleX(${share})` }} />
            </span>
            <span className={styles.meterText}>
              of the ideas she first met by {HOW_SHE_LEARNS[mode] ?? mode.replaceAll("_", " ")} are solid now.
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const SHOWN_CARDS = 3;

function Cards({ cards }: { cards: DashboardView["cards"] }) {
  const card = (c: (typeof cards)[number]) => (
    <li key={c.card_id} className={styles.card}>
      <h3>{topicName(c.topic)}</h3>
      <p className={styles.quiet}>
        Grade {c.grade}, {formatMonth(c.at)}
      </p>
      <p className={styles.clamp}>{plainSummary(c.summary)}</p>
      <p className={styles.starter}>
        <span>Start a conversation.</span> {c.starter}
      </p>
    </li>
  );
  return (
    <section className={styles.section} aria-labelledby="cards-h">
      <h2 id="cards-h">Big questions</h2>
      <p className={styles.lede}>Times she asked about something you wanted to hear about, newest first.</p>
      {cards.length === 0 && <p className={styles.quiet}>No big questions yet.</p>}
      <ul className={styles.plainList}>{cards.slice(0, SHOWN_CARDS).map(card)}</ul>
      {cards.length > SHOWN_CARDS && (
        <details className={styles.more}>
          <summary>{cards.length - SHOWN_CARDS} earlier big questions</summary>
          <ul className={styles.plainList}>{cards.slice(SHOWN_CARDS).map(card)}</ul>
        </details>
      )}
    </section>
  );
}

const OPEN_YEARS = 2;

function Moments({ moments }: { moments: DashboardView["moments_by_grade"] }) {
  const years = Object.entries(moments).sort((a, b) => Number(b[0]) - Number(a[0]));
  const year = ([g, items]: (typeof years)[number]) => (
    <li key={g} className={styles.year}>
      <h3>Grade {g}</h3>
      <ul>
        {items.map((m, i) => (
          <li key={i}>{momentForParent(m)}</li>
        ))}
      </ul>
    </li>
  );
  return (
    <section className={styles.section} aria-labelledby="moments-h">
      <h2 id="moments-h">Moments by grade</h2>
      <p className={styles.lede}>Ideas she figured out and things she taught Kite.</p>
      {years.length === 0 && <p className={styles.quiet}>No moments yet.</p>}
      <ul className={styles.plainList}>{years.slice(0, OPEN_YEARS).map(year)}</ul>
      {years.length > OPEN_YEARS && (
        <details className={styles.more}>
          <summary>
            Grades {years.at(-1)![0]} to {years[OPEN_YEARS][0]}
          </summary>
          <ul className={styles.plainList}>{years.slice(OPEN_YEARS).map(year)}</ul>
        </details>
      )}
    </section>
  );
}
