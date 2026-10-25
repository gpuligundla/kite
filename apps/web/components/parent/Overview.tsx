"use client";

import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { MiniComb } from "./SkillsMap";
import {
  HOW_SHE_LEARNS, KID, STYLE_WORDS, curiosityYears, growing, knowledgeMap, lately, percent, portrait, standings, topicName,
  type Alert, type Comb, type DashboardView, type Grade, type Standing,
} from "./model";
import ui from "./parent.module.css";
import t from "./tabs.module.css";

/** Everything here is as of the end of `grade`. */
export function Overview({ view, grade, alerts }: { view: DashboardView; grade: Grade; alerts: Alert[] }) {
  const p = portrait(view);
  return (
    <div className={t.overview}>
      <div className={`${ui.hero} ${t.ovHero}`}>
        <Standings view={view} grade={grade} />
        <dl className={t.figures}>
          <div>
            <dt>Ideas that are solid</dt>
            <dd className={ui.figure}>
              {p.solid}
              <small> of {p.shown}</small>
            </dd>
          </div>
          <div>
            <dt>She could teach back</dt>
            <dd className={ui.figure}>{p.canTeach}</dd>
          </div>
          <div>
            <dt>Asks most about</dt>
            <dd className={ui.figure}>{p.curious ?? <small>Not enough yet</small>}</dd>
          </div>
        </dl>
      </div>
      <News view={view} grade={grade} alerts={alerts} />
      <HowSheLearns shares={view.how_she_learns} />
      <Asks view={view} grade={grade} />
      <World view={view} />
    </div>
  );
}

function Standings({ view, grade }: { view: DashboardView; grade: Grade }) {
  const reduce = useReducedMotion();
  const combs = new Map(knowledgeMap(view).map((c) => [c.topic, c]));
  const all = standings(view, grade);
  const still = growing(view);
  const groups = [
    { title: "Strengths", items: all.filter((s) => s.strength), empty: "None yet at this grade." },
    { title: "Getting there", items: all.filter((s) => !s.strength), empty: "Nothing close right now." },
  ];
  return (
    <section className={t.standings} aria-labelledby="standing-h">
      <h2 id="standing-h" className={t.heroTitle}>
        Where {KID.name} is strong
      </h2>
      <p className={ui.lede}>A strength is a topic she asks about often where at least 3 in 4 of the ideas she&apos;s shown Kite are solid.</p>
      <LayoutGroup>
        <div className={t.standCols}>
          {groups.map((g, gi) => (
            <div key={g.title} className={gi === 0 ? t.strongCol : t.nearCol}>
              <h3>{g.title}</h3>
              <ul>
                {g.items.map((s) => (
                  <motion.li
                    key={s.topic}
                    layoutId={`standing-${s.topic}`}
                    layout={reduce ? false : "position"}
                    layoutDependency={grade}
                    transition={{ duration: 0.26, ease: [0.77, 0, 0.175, 1] }}
                    className={t.standing}
                    data-strength={s.strength}
                  >
                    {combs.get(s.topic) && <MiniComb comb={combs.get(s.topic) as Comb} size={s.strength ? 84 : 56} />}
                    <div>
                      <strong>{s.name}</strong>
                      <span>{standingLine(s)}</span>
                    </div>
                  </motion.li>
                ))}
                {g.items.length === 0 && <li className={ui.empty}>{g.empty}</li>}
              </ul>
            </div>
          ))}
          <div className={t.nearCol}>
            <h3>Still growing</h3>
            <ul>
              {still.map((s) => (
                <li key={s.name} className={t.growing}>
                  {/* Named by idea, not topic: a topic can be a strength while one of its ideas is still growing. */}
                  <strong>{list(s.concepts)}</strong>
                  <span>
                    Part of {s.name.toLowerCase()}. Worked on across several sessions, not solid yet.
                  </span>
                </li>
              ))}
              {still.length === 0 && <li className={ui.empty}>Nothing stuck right now.</li>}
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
  const settling = s.unsettled.length ? ` Still settling: ${list(s.unsettled)}.` : "";
  return `She asks about it a lot. ${solid}; a strength needs 3 in 4.${settling}`;
}

const list = (xs: string[]) => new Intl.ListFormat("en-US").format(xs);
const dayFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });

function News({ view, grade, alerts }: { view: DashboardView; grade: Grade; alerts: Alert[] }) {
  const news = lately(view, grade, grade === KID.grade, alerts, Date.now());
  return (
    <section className={`${ui.panel} ${t.news}`} aria-labelledby="news-h">
      <h2 id="news-h">{news.title}</h2>
      {news.items.length === 0 ? (
        <p className={ui.empty}>Nothing new. Alerts, big questions and new ideas land here as they happen.</p>
      ) : (
        <ul className={t.newsList}>
          {news.items.map((h) => (
            <li key={h.key} data-kind={h.kind}>
              <span>{h.text}</span>
              {h.at && <time dateTime={h.at}>{dayFmt.format(new Date(h.at))}</time>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function HowSheLearns({ shares }: { shares: DashboardView["how_she_learns"] }) {
  const rows = Object.entries(shares ?? {}).sort((a, b) => b[1] - a[1]);
  const way = (mode: string) => HOW_SHE_LEARNS[mode] ?? mode.replaceAll("_", " ");
  const [best, ...rest] = rows;
  return (
    <section className={`${ui.panel} ${t.learns}`} aria-labelledby="learns-h">
      <h2 id="learns-h">How she learns best</h2>
      {!best && <p className={ui.empty}>Not enough to tell yet. It fills in as she teaches Kite, answers check questions and plays games.</p>}
      {best && (
        <div className={t.ring}>
          <svg viewBox="0 0 120 120" aria-hidden>
            <circle cx="60" cy="60" r="50" className={t.ringTrack} />
            <circle cx="60" cy="60" r="50" className={t.ringFill} pathLength={100} strokeDasharray={`${best[1] * 100} 100`} />
          </svg>
          <span className={ui.figure}>{percent(best[1])}</span>
        </div>
      )}
      {best && (
        <p className={t.learnsText}>
          of the ideas she first met by <strong>{way(best[0])}</strong> are solid now.
        </p>
      )}
      {rest.map(([mode, share]) => (
        <p key={mode} className={ui.quiet}>
          {percent(share)} by {way(mode)}.
        </p>
      ))}
    </section>
  );
}

function Asks({ view, grade }: { view: DashboardView; grade: Grade }) {
  const { topics, years } = curiosityYears(view, grade);
  const year = years.find((y) => y.grade === grade);
  const rows = year ? [...topics.map((tp, i) => ({ name: tp.name, share: year.shares[i] })), { name: "Everything else", share: year.shares.at(-1)! }].filter((r) => r.share >= 0.005) : [];
  const top = [...rows].sort((a, b) => b.share - a.share)[0];
  return (
    <section className={`${ui.panel} ${t.asks}`} aria-labelledby="asks-h">
      <h2 id="asks-h">What she asks about</h2>
      {top ? (
        <p className={ui.lede}>
          In grade {grade}, {percent(top.share)} of her questions were about {top.name.toLowerCase()}.
        </p>
      ) : (
        <p className={ui.empty}>No questions yet in grade {grade}. Her questions, follow-ups and return visits show here by topic.</p>
      )}
      <ul className={t.bars}>
        {rows.map((r) => (
          <li key={r.name}>
            <span className={t.barName}>{r.name}</span>
            <span className={t.barValue}>{percent(r.share)}</span>
            <span className={t.barTrack} aria-hidden>
              <span style={{ transform: `scaleX(${r.share})` }} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function World({ view }: { view: DashboardView }) {
  const { interests, characters, styles } = view.profile;
  const strong = new Set(view.strengths ?? []);
  return (
    <section className={`${ui.panel} ${t.world}`} aria-labelledby="world-h">
      <h2 id="world-h">Her world</h2>
      <div className={t.worldCols}>
        <div>
          <h3>Topics she&apos;s explored</h3>
          {interests.length === 0 && <p className={ui.empty}>Topics appear as she asks Kite about them.</p>}
          <ul className={ui.chips}>
            {interests.map((i) => (
              <li key={i} data-strong={strong.has(i)}>
                {topicName(i)}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Her characters</h3>
          {characters.length === 0 ? (
            <p className={ui.empty}>Characters she invents for her stories and movies show up here.</p>
          ) : (
            <ul className={t.cast}>
              {characters.map((c) => (
                <li key={c}>
                  <span className={t.castMark} aria-hidden>
                    {c.charAt(0)}
                  </span>
                  {c}
                </li>
              ))}
            </ul>
          )}
          <h3>Likes to learn with</h3>
          <p className={t.styles}>{styles.length ? list(styles.map((s) => STYLE_WORDS[s] ?? s)) : "Not enough to tell yet."}</p>
        </div>
      </div>
    </section>
  );
}
