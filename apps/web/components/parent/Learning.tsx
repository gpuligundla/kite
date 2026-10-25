"use client";

import { CuriosityChart } from "./CuriosityChart";
import { MapKey, SkillsMap } from "./SkillsMap";
import { KID, LEVELS, LEVEL_WORDS, growing, knowledgeMap, type DashboardView, type Grade } from "./model";
import ui from "./parent.module.css";
import t from "./tabs.module.css";

export function Learning({ view, grade }: { view: DashboardView; grade: Grade }) {
  const combs = knowledgeMap(view);
  const concepts = view.skills.concepts;
  const counts = LEVELS.map((l) => ({ level: l, n: concepts.filter((c) => c.level === l).length }));
  const still = growing(view);

  return (
    <div className={t.learning}>
      <section className={`${ui.hero} ${t.mapHero}`} aria-labelledby="map-h">
        <div className={t.mapHead}>
          <div>
            <h2 id="map-h" className={t.heroTitle}>
              Knowledge map
            </h2>
            <p className={ui.lede}>
              Each hexagon is one idea, grouped by topic: her first idea in the middle, later ones spiralling out. Only
              what she does counts: teaching it back, a check question, or a game.
            </p>
          </div>
          <dl className={t.mapStats}>
            <div>
              <dt>Topics</dt>
              <dd className={ui.figure}>{combs.length}</dd>
            </div>
            <div>
              <dt>Ideas shown</dt>
              <dd className={ui.figure}>{concepts.length}</dd>
            </div>
            <div>
              <dt>Strengths</dt>
              <dd className={ui.figure}>{combs.filter((c) => c.strength).length}</dd>
            </div>
          </dl>
        </div>
        <MapKey />
        <SkillsMap view={view} />
      </section>

      <CuriosityChart view={view} grade={grade} />

      <section className={`${ui.panel} ${t.levels}`} aria-labelledby="levels-h">
        <h2 id="levels-h">Where her ideas stand</h2>
        <p className={ui.lede}>
          {concepts.length
            ? `Of the ${concepts.length} ideas ${KID.name} has shown Kite by the end of grade ${grade}.`
            : `Nothing shown yet by the end of grade ${grade}.`}
        </p>
        {concepts.length > 0 && (
          <>
            <div className={t.stack} aria-hidden>
              {[...counts].reverse().map(({ level, n }) =>
                n ? <span key={level} style={{ flexGrow: n, background: `var(--lv-${level})` }} /> : null,
              )}
            </div>
            <ul className={t.levelRows}>
              {[...counts].reverse().map(({ level, n }) => (
                <li key={level}>
                  <span className={t.dot} style={{ background: `var(--lv-${level})` }} aria-hidden />
                  <span>{LEVEL_WORDS[level]}</span>
                  <strong>{n}</strong>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className={`${ui.panel} ${t.growPanel}`} aria-labelledby="grow-h">
        <h2 id="grow-h">Still growing</h2>
        <p className={ui.lede}>Ideas she has worked on across several sessions that aren&apos;t solid yet.</p>
        {still.length === 0 && <p className={ui.empty}>Nothing stuck right now. Ideas show here when two or more sessions haven&apos;t settled them.</p>}
        <ul className={t.growList}>
          {still.flatMap((s) =>
            s.concepts.map((c) => (
              <li key={c}>
                <strong>{c}</strong>
                <span>{s.name}</span>
              </li>
            )),
          )}
        </ul>
      </section>
    </div>
  );
}
