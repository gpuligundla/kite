import { curiosityYears, percent, topicName, type DashboardView, type Grade } from "./model";
import styles from "./parent.module.css";

const W = 560;
const H = 200;
const M = { left: 52, right: 8, top: 12, bottom: 30 };
const PLOT_H = H - M.top - M.bottom;
const BASE = H - M.bottom;
// Slot order is fixed; a topic keeps its color as long as it keeps its rank. Validated with the dataviz
// palette script (all pairs, light, on --mist): kite red, tail teal, and kite yellow stepped down to #e0a100.
const SLOTS = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)"];
const OTHER = "var(--viz-other)";

/** 100% stacked columns: each grade's share of her curiosity, top three topics plus everything else. */
export function CuriosityChart({ view, grade }: { view: DashboardView; grade: Grade }) {
  const { series, rows } = curiosityYears(view);
  const lately = view.curiosity.topics.filter((t) => t.score >= 0.5).slice(0, 3).map((t) => topicName(t.topic).toLowerCase());
  const band = (W - M.left - M.right) / Math.max(rows.length, 1);
  const barW = Math.min(24, band * 0.6);
  const names = [...series.map((s) => s.name), "Everything else"];

  return (
    <section className={styles.section} aria-labelledby="curious-h">
      <h2 id="curious-h">What she&apos;s curious about</h2>
      <p className={styles.lede}>
        {lately.length > 0 && <>Lately she asks most about {new Intl.ListFormat("en-US").format(lately)}. </>}
        Below, each school year&apos;s share of her questions, follow-ups and return visits.
      </p>
      {rows.length === 0 ? (
        <p className={styles.quiet}>No questions yet at this grade.</p>
      ) : (
        <div className={styles.chart}>
          <ul className={styles.legend}>
            {names.map((n, i) => (
              <li key={n}>
                <span className={styles.swatch} style={{ background: SLOTS[i] ?? OTHER }} />
                {n}
              </li>
            ))}
          </ul>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Share of her curiosity by grade, up to grade ${grade}. The table below has the numbers.`}>
            {[0, 0.5, 1].map((v) => (
              <g key={v}>
                <line x1={M.left} x2={W - M.right} y1={BASE - v * PLOT_H} y2={BASE - v * PLOT_H} className={styles.grid} />
                <text x={M.left - 8} y={BASE - v * PLOT_H} className={styles.axis} textAnchor="end" dominantBaseline="middle">
                  {percent(v)}
                </text>
              </g>
            ))}
            {rows.map((r, i) => {
              const x = M.left + band * i + (band - barW) / 2;
              let cum = 0;
              const segs = [...r.shares, r.other].map((share, k) => {
                const h = share * PLOT_H;
                const y = BASE - cum - h;
                cum += h;
                const drawn = h - (k > 0 ? 2 : 0);
                return drawn >= 1 ? <rect key={k} x={x} y={y} width={barW} height={drawn} fill={SLOTS[k] ?? OTHER} /> : null;
              });
              return (
                <g key={r.grade} className={styles.column}>
                  {segs}
                  <rect x={M.left + band * i} y={M.top} width={band} height={PLOT_H} fill="transparent">
                    <title>
                      {`Grade ${r.grade}: ` + [...r.shares, r.other].map((s, k) => `${names[k]} ${percent(s)}`).join(", ")}
                    </title>
                  </rect>
                  <text x={x + barW / 2} y={H - 6} textAnchor="middle" className={styles.axis} data-on={r.grade === grade}>
                    {r.grade}
                  </text>
                </g>
              );
            })}
          </svg>
          <details className={styles.more}>
            <summary>Show as a table</summary>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Grade</th>
                  {names.map((n) => (
                    <th key={n} scope="col">{n}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.grade}>
                    <th scope="row">{r.grade}</th>
                    {[...r.shares, r.other].map((s, k) => (
                      <td key={k}>{percent(s)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      )}
    </section>
  );
}
