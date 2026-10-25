"use client";

import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { CuriosityChart } from "./CuriosityChart";
import { SkillsMap } from "./SkillsMap";
import {
  HOW_SHE_LEARNS, KID, formatMonth, growing, lately, momentForParent, percent, plainSummary, portrait, standings, topicName,
  type Alert, type DashboardView, type Grade, type Standing,
} from "./model";
import styles from "./parent.module.css";

/** Everything here is as of the end of `grade`. `stale` holds the last render dimmed while the next grade loads. */
export function Overview({ view, grade, stale, alerts }: { view: DashboardView; grade: Grade; stale: boolean; alerts: Alert[] }) {
  return (
    <div className={styles.overview} data-stale={stale}>
      <Summary view={view} grade={grade} alerts={alerts} />
      <Standings view={view} grade={grade} />
      <div className={styles.mapPanel}>
        <SkillsMap view={view} />
        <hr className={styles.mapRule} />
        <CuriosityChart view={view} grade={grade} />
      </div>
      <div className={styles.lower}>
        <div className={styles.lowerSide}>
          <HowSheLearns shares={view.how_she_learns} />
          <Moments moments={view.moments_by_grade} />
        </div>
        <Cards cards={view.cards} />
      </div>
    </div>
  );
}

function Summary({ view, grade, alerts }: { view: DashboardView; grade: Grade; alerts: Alert[] }) {
  const p = portrait(view);
  const news = lately(view, grade, grade === KID.grade, alerts, Date.now());
  return (
    <section className={styles.summary} aria-labelledby="summary-h">
      <h2 id="summary-h" className={styles.srOnly}>
        {KID.name} at a glance
      </h2>
      <dl className={styles.facts}>
        <div>
          <dt>Strong in</dt>
          <dd className={styles.factBig}>
            {p.strengths.length > 0 ? (
              p.strengths.map((s) => (
                <span key={s} className={styles.strongIn}>
                  <Hex filled /> {s}
                </span>
              ))
            ) : (
              <span className={styles.factNone}>Nothing yet</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Asks most about</dt>
          <dd className={styles.factBig}>{p.curious ?? <span className={styles.factNone}>Not enough yet</span>}</dd>
        </div>
        <div>
          <dt>Ideas that are solid</dt>
          <dd className={styles.factBig}>
            {p.solid} <span className={styles.factOf}>of {p.shown}</span>
          </dd>
          <dd className={styles.factNote}>She could teach {p.canTeach} of them back.</dd>
        </div>
        <div>
          <dt>Learns best by</dt>
          {p.best ? (
            <>
              <dd className={styles.factBig}>{p.best.way.charAt(0).toUpperCase() + p.best.way.slice(1)}</dd>
              <dd className={styles.factNote}>{percent(p.best.share)} of the ideas she met that way are solid.</dd>
            </>
          ) : (
            <dd className={styles.factBig}>
              <span className={styles.factNone}>Not enough yet</span>
            </dd>
          )}
        </div>
      </dl>
      <div className={styles.news}>
        <h3>{news.title}</h3>
        {news.items.length === 0 ? (
          <p className={styles.quiet}>Nothing new.</p>
        ) : (
          <ul>
            {news.items.map((h) => (
              <li key={h.key} data-kind={h.kind}>
                <span>{h.text}</span>
                {h.at && <time dateTime={h.at}>{dayTime(h.at)}</time>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

const dayFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });
const dayTime = (iso: string) => dayFmt.format(new Date(iso));

function Hexes({ solid, total }: { solid: number; total: number }) {
  return (
    <span className={styles.hexes} aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <Hex key={i} filled={i < solid} />
      ))}
    </span>
  );
}

function Hex({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="-7 -8 14 16" className={styles.miniHex} data-filled={filled}>
      <path d="M0,-7L6.06,-3.5L6.06,3.5L0,7L-6.06,3.5L-6.06,-3.5Z" />
    </svg>
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
          {groups.map((g, gi) => (
            <div key={g.title} className={gi === 0 ? styles.strengthCol : styles.nearCol}>
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
                    <Hexes solid={s.solid} total={s.total} />
                    <span>{standingLine(s)}</span>
                  </motion.li>
                ))}
                {g.items.length === 0 && <li className={styles.emptyNote}>{g.empty}</li>}
              </ul>
            </div>
          ))}
          <div className={styles.growCol}>
            <h3>Still growing</h3>
            <ul className={styles.plainList}>
              {still.map((t) => (
                <li key={t.name} className={styles.growing}>
                  {/* Named by idea, not topic: a topic can be a strength while one of its ideas is still growing. */}
                  <strong>{list(t.concepts)}</strong>
                  <span>
                    Part of {t.name.toLowerCase()}. She has worked on {t.concepts.length > 1 ? "these" : "it"} across
                    several sessions, and {t.concepts.length > 1 ? "they aren't" : "it isn't"} solid yet.
                  </span>
                </li>
              ))}
              {still.length === 0 && <li className={styles.emptyNote}>Nothing stuck right now.</li>}
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
const quote = (s: string) => `“${s}”`;

function HowSheLearns({ shares }: { shares: DashboardView["how_she_learns"] }) {
  const rows = Object.entries(shares ?? {}).sort((a, b) => b[1] - a[1]);
  const way = (mode: string) => HOW_SHE_LEARNS[mode] ?? mode.replaceAll("_", " ");
  return (
    <section className={styles.section} aria-labelledby="learns-h">
      <h2 id="learns-h">How she learns</h2>
      {rows.length === 0 && <p className={styles.lede}>Not enough to tell yet.</p>}
      {rows.slice(0, 1).map(([mode, share]) => (
        <p key={mode} className={styles.bigStat}>
          <span className={styles.bigFigure}>{percent(share)}</span>
          <span>of the ideas she first met by {way(mode)} are solid now.</span>
        </p>
      ))}
      <ul className={styles.plainList}>
        {rows.slice(1).map(([mode, share]) => (
          <li key={mode} className={styles.meterRow}>
            <span className={styles.meterValue}>{percent(share)}</span>
            <span className={styles.meter} aria-hidden>
              <span style={{ transform: `scaleX(${share})` }} />
            </span>
            <span className={styles.meterText}>of the ideas she first met by {way(mode)} are solid now.</span>
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
      <div className={styles.cardHead}>
        <h3>{topicName(c.topic)}</h3>
        <span className={styles.quiet}>
          Grade {c.grade}, {formatMonth(c.at)}
        </span>
      </div>
      <p className={styles.clamp}>{plainSummary(c.summary)}</p>
      <p className={styles.starter}>
        <strong>Start a conversation</strong>
        {c.starter}
      </p>
    </li>
  );
  return (
    <section className={styles.section} aria-labelledby="cards-h">
      <h2 id="cards-h">Big questions</h2>
      <p className={styles.lede}>Times she asked about something you wanted to hear about, newest first.</p>
      {cards.length === 0 && <p className={styles.quiet}>No big questions yet.</p>}
      <ul className={styles.cardList}>{cards.slice(0, SHOWN_CARDS).map(card)}</ul>
      {cards.length > SHOWN_CARDS && (
        <details className={styles.more}>
          <summary>{cards.length - SHOWN_CARDS} earlier big questions</summary>
          <ul className={styles.cardList}>{cards.slice(SHOWN_CARDS).map(card)}</ul>
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
      <ol className={styles.timeline}>{years.slice(0, OPEN_YEARS).map(year)}</ol>
      {years.length > OPEN_YEARS && (
        <details className={styles.more}>
          <summary>
            Grades {years.at(-1)![0]} to {years[OPEN_YEARS][0]}
          </summary>
          <ol className={styles.timeline}>{years.slice(OPEN_YEARS).map(year)}</ol>
        </details>
      )}
    </section>
  );
}
