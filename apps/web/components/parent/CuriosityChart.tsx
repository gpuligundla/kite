"use client";

import { Tip, useTip } from "./Tip";
import { curiosityYears, percent, type DashboardView, type Grade } from "./model";
import ui from "./parent.module.css";
import t from "./tabs.module.css";

// Categorical slots in fixed order, then Other. Checked with the dataviz validator against the console surface:
// adjacent CVD separation ΔE 13.5 or more. They sit above its lightness band on purpose: DESIGN.md wants them vivid.
const SERIES = ["#ffc83d", "#4cc3ff", "#ff5fa2", "#9d86ff"];
const OTHER = "rgba(238, 241, 255, 0.22)";

const W = 640;
const H = 260;
const M = { left: 48, right: 16, top: 12, bottom: 30 };
const BAR = 24;
const GAP = 2;
const y = (v: number) => M.top + (1 - v) * (H - M.top - M.bottom);

/** Each school year as one column: how her curiosity split between topics. 100% stacked, oldest year on the left. */
export function CuriosityChart({ view, grade }: { view: DashboardView; grade: Grade }) {
  const { topics, years } = curiosityYears(view, grade);
  const { box, tip, show, hide } = useTip<HTMLDivElement>();
  const names = [...topics.map((tp) => tp.name), "Everything else"];
  const colors = [...SERIES.slice(0, topics.length), OTHER];
  const slot = (W - M.left - M.right) / Math.max(years.length, 1);
  const x = (i: number) => M.left + slot * i + slot / 2;
  const first = years[0];
  const last = years.at(-1);
  const lead = last && topics.length ? topics[last.shares.slice(0, -1).indexOf(Math.max(...last.shares.slice(0, -1)))] : null;

  return (
    <section className={`${ui.panel} ${t.years}`} aria-labelledby="years-h">
      <h2 id="years-h">Curiosity over the years</h2>
      <p className={ui.lede}>
        {last && lead
          ? `Each column is one school year of her questions, follow-ups and return visits. In grade ${last.grade}, ${lead.name.toLowerCase()} led.`
          : "Each school year of her questions shows here as one column, split by topic."}
      </p>
      {years.length > 0 && (
        <>
          <ul className={t.legend}>
            {names.map((n, i) => (
              <li key={n}>
                <span style={{ background: colors[i] }} aria-hidden />
                {n}
              </li>
            ))}
          </ul>
          <div ref={box} className={t.chart}>
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Share of her curiosity by topic, grades ${first!.grade} to ${last!.grade}. The table below has the numbers.`}>
              {[0, 0.5, 1].map((v) => (
                <g key={v}>
                  <line x1={M.left} x2={W - M.right} y1={y(v)} y2={y(v)} className={t.grid} />
                  <text x={M.left - 8} y={y(v)} textAnchor="end" dominantBaseline="middle" className={t.axis}>
                    {percent(v)}
                  </text>
                </g>
              ))}
              {years.map((yr, i) => {
                let top = 0;
                return (
                  <g
                    key={yr.grade}
                    className={t.column}
                    tabIndex={0}
                    role="img"
                    aria-label={`Grade ${yr.grade}: ${names.map((n, k) => `${n} ${percent(yr.shares[k])}`).join(", ")}`}
                    onPointerEnter={(e) => show(e.currentTarget, <YearTip grade={yr.grade} names={names} shares={yr.shares} colors={colors} />)}
                    onPointerLeave={hide}
                    onFocus={(e) => show(e.currentTarget, <YearTip grade={yr.grade} names={names} shares={yr.shares} colors={colors} />)}
                    onBlur={hide}
                  >
                    <rect x={x(i) - slot / 2} y={M.top} width={slot} height={H - M.top - M.bottom} className={t.hit} />
                    {yr.shares.map((s, k) => {
                      const y0 = y(top);
                      top += s;
                      const h = Math.max(0, y0 - y(top) - GAP);
                      return h > 0.5 ? <rect key={k} x={x(i) - BAR / 2} y={y(top)} width={BAR} height={h} rx={k === 0 ? 0 : 3} style={{ fill: colors[k] }} /> : null;
                    })}
                    <text x={x(i)} y={H - 8} textAnchor="middle" className={t.axis} data-on={yr.grade === grade}>
                      {yr.grade}
                    </text>
                  </g>
                );
              })}
            </svg>
            <Tip tip={tip} />
          </div>
          <details className={ui.more}>
            <summary>Show as a table</summary>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th scope="col">Grade</th>
                  {names.map((n) => (
                    <th key={n} scope="col">
                      {n}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {years.map((yr) => (
                  <tr key={yr.grade}>
                    <th scope="row">{yr.grade}</th>
                    {yr.shares.map((s, k) => (
                      <td key={k}>{percent(s)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}

function YearTip({ grade, names, shares, colors }: { grade: number; names: string[]; shares: number[]; colors: string[] }) {
  return (
    <>
      <strong>Grade {grade}</strong>
      {names.map((n, k) =>
        shares[k] >= 0.005 ? (
          <span key={n} className={t.tipRow}>
            <i style={{ background: colors[k] }} />
            {n} {percent(shares[k])}
          </span>
        ) : null,
      )}
    </>
  );
}
