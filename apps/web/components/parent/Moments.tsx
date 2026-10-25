"use client";

import { KID, momentYears, type DashboardView, type Grade } from "./model";
import ui from "./parent.module.css";
import t from "./tabs.module.css";

const W = 560;
const H = 200;
const M = { left: 8, right: 8, top: 22, bottom: 26 };
const BAR = 24;

/** Ideas she figured out and ideas she taught Kite, year by year. Moments carry a grade, not a date. */
export function Moments({ view, grade }: { view: DashboardView; grade: Grade }) {
  const years = momentYears(view);
  const figured = years.reduce((s, y) => s + y.figured.length, 0);
  const taught = years.reduce((s, y) => s + y.taught.length, 0);
  const busiest = years.reduce<(typeof years)[number] | null>((b, y) => (!b || y.figured.length + y.taught.length > b.figured.length + b.taught.length ? y : b), null);
  const oldestFirst = [...years].reverse();
  const max = Math.max(1, ...years.map((y) => y.figured.length + y.taught.length));
  const slot = (W - M.left - M.right) / Math.max(1, grade);
  const x = (g: number) => M.left + slot * (g - 1) + slot / 2;
  const y = (n: number) => H - M.bottom - (n / max) * (H - M.top - M.bottom);

  return (
    <div className={t.moments}>
      <section className={`${ui.hero} ${t.momentsHero}`} aria-labelledby="moments-h">
        <div>
          <h2 id="moments-h" className={t.heroTitle}>
            {figured + taught === 0 ? "No moments yet" : `${figured + taught} moments since grade ${oldestFirst[0]?.grade ?? KID.firstGrade}`}
          </h2>
          <p className={ui.lede}>
            A moment is an idea {KID.name} figured out, or one she taught back to Kite. Teaching it back is the strongest sign
            an idea has stuck.
          </p>
          <dl className={t.momentStats}>
            <div data-kind="figured">
              <dt>Figured out</dt>
              <dd className={ui.figure}>{figured}</dd>
            </div>
            <div data-kind="taught">
              <dt>Taught Kite</dt>
              <dd className={ui.figure}>{taught}</dd>
            </div>
            {busiest && (
              <div>
                <dt>Busiest year</dt>
                <dd className={ui.figure}>
                  <small>Grade </small>
                  {busiest.grade}
                </dd>
              </div>
            )}
          </dl>
        </div>
        {years.length > 0 && (
          <div className={t.momentChart}>
            {/* The Figured out and Taught Kite figures beside the chart carry its legend swatches. */}
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Moments per school year. The timeline below lists every one.">
              <line x1={M.left} x2={W - M.right} y1={y(0)} y2={y(0)} className={t.grid} />
              {Array.from({ length: grade }, (_, i) => i + 1).map((g) => {
                const yr = years.find((v) => v.grade === g);
                const f = yr?.figured.length ?? 0;
                const k = yr?.taught.length ?? 0;
                return (
                  <g key={g}>
                    {f > 0 && <rect x={x(g) - BAR / 2} y={y(f)} width={BAR} height={y(0) - y(f)} rx={k ? 0 : 4} style={{ fill: "var(--c-figured)" }} />}
                    {k > 0 && <rect x={x(g) - BAR / 2} y={y(f + k)} width={BAR} height={y(f) - y(f + k) - (f ? 2 : 0)} rx={4} style={{ fill: "var(--c-taught)" }} />}
                    {f + k > 0 && (
                      <text x={x(g)} y={y(f + k) - 6} textAnchor="middle" className={t.capLabel}>
                        {f + k}
                      </text>
                    )}
                    <text x={x(g)} y={H - 6} textAnchor="middle" className={t.axis}>
                      {g}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        )}
      </section>

      {years.length === 0 && <p className={ui.empty}>When she figures something out or teaches it back to Kite, it lands here under its school year.</p>}
      <ol className={t.timeline}>
        {years.map((yr) => (
          <li key={yr.grade} className={t.yearRow}>
            <div className={t.yearMark}>
              <span className={ui.figure}>{yr.grade}</span>
              <span>Grade</span>
            </div>
            <div className={`${ui.panel} ${t.yearBody}`}>
              {yr.taught.length > 0 && (
                <div>
                  <h3>Taught Kite</h3>
                  <ul className={t.momentChips} data-kind="taught">
                    {yr.taught.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}
              {yr.figured.length > 0 && (
                <div>
                  <h3>Figured out</h3>
                  <ul className={t.momentChips} data-kind="figured">
                    {yr.figured.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
