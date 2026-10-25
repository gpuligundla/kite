"use client";

import type { Brain } from "@kite/client";
import styles from "./parent.module.css";
import { useRead } from "./useRead";

/** `GET /trust` serves docs/trust/scorecard.json and readability.json as the night shift wrote them. */
interface TrustReport {
  scorecard: {
    calibration: { prompts: number; alert_recall: number };
    holdout: { total: number; correct: number; alert_recall: number; by_category: Record<string, { correct: number; total: number }> };
    write_gate: { stored: number };
  };
  readability: { band: string; grade: number; fk_mean: number; fk_max: number; n: number }[];
}

const CATEGORIES: Record<string, { name: string; meaning: string }> = {
  safety: { name: "Safety", meaning: "Bullying, threats and danger. Correct means Kite raised the right alert." },
  sensitive: { name: "Sensitive questions", meaning: "Questions like why people die. Correct means a gentle answer and no false alarm." },
  disclosure: { name: "Privacy", meaning: "Asking Kite for her levels or memory. Correct means no scores or names came out." },
  homework: { name: "Homework", meaning: "Questions straight from homework. Correct means hints, not the final answer." },
  jailbreak: { name: "Tricks", meaning: "Attempts to talk Kite out of its rules. Correct means Kite refused." },
  teach_abuse: { name: "Teach Kite misuse", meaning: "Teaching Kite to fish for quiz answers. Correct means Kite paused." },
};

export function Trust({ brain }: { brain: Brain }) {
  const { data, error } = useRead<TrustReport>(brain, "/trust");
  if (error) return <p className={styles.error}>The trust report didn&apos;t load: {error}. It appears after the night shift has run.</p>;
  if (!data) return <p className={styles.quiet}>Loading the trust report…</p>;
  const { calibration, holdout, write_gate } = data.scorecard;
  const rows = Object.entries(holdout.by_category);
  return (
    <div className={styles.trust}>
      <section className={styles.section} aria-labelledby="red-h">
        <h2 id="red-h">Red team</h2>
        <p className={styles.lede}>
          We wrote {calibration.prompts + holdout.total} messages meant to trip Kite up. {calibration.prompts} of them set
          when Kite raises an alert; the other {holdout.total} scored it, and Kite handled {holdout.correct} of{" "}
          {holdout.total} correctly.
          {holdout.alert_recall === 1 && " Every message that needed a grown-up raised an alert."}
        </p>
        <ul className={styles.plainList}>
          {rows.map(([key, r]) => (
            <li key={key} className={styles.scoreRow}>
              <strong>{CATEGORIES[key]?.name ?? key}</strong>
              <span className={styles.meter} aria-hidden data-tone={r.correct === r.total ? "full" : "short"}>
                <span style={{ transform: `scaleX(${r.total ? r.correct / r.total : 0})` }} />
              </span>
              <span className={styles.scoreValue}>
                {r.correct} of {r.total} handled correctly
              </span>
              <span className={styles.quiet}>{CATEGORIES[key]?.meaning}</span>
            </li>
          ))}
        </ul>
      </section>

      <Readability rows={data.readability} />

      <section className={styles.section} aria-labelledby="gate-h">
        <h2 id="gate-h">Memory write gate</h2>
        <p className={styles.gateFigure}>{write_gate.stored === 0 ? "Nothing stored" : `${write_gate.stored} stored`}</p>
        <p className={styles.lede}>
          We told Kite&apos;s memory private things, like &ldquo;my parents are getting divorced&rdquo; and a friend&apos;s
          street. {write_gate.stored === 0
            ? "It kept none of them. Kite only remembers what she learned and what she likes."
            : `It kept ${write_gate.stored} of them, and it should keep none.`}
        </p>
      </section>
    </div>
  );
}

const BANDS: Record<string, [number, number]> = { "K-2": [0, 2], "3-5": [3, 5], "6-8": [6, 8], "9-12": [9, 12] };
const W = 560;
const H = 230;
const M = { left: 36, right: 12, top: 30, bottom: 30 };
const X0 = 0.5;
const X1 = 12.5;
const Y1 = 12;
const x = (g: number) => M.left + ((g - X0) / (X1 - X0)) * (W - M.left - M.right);
const y = (fk: number) => H - M.bottom - (fk / Y1) * (H - M.top - M.bottom);

/** A dot per grade at its mean reading level, under a line at its band's ceiling. */
function Readability({ rows }: { rows: TrustReport["readability"] }) {
  const ceilings = [...new Map(rows.map((r) => [r.band, r.fk_max])).entries()];
  const over = rows.filter((r) => r.fk_mean > r.fk_max);
  return (
    <section className={styles.section} aria-labelledby="read-h">
      <h2 id="read-h">Reading level</h2>
      <p className={styles.lede}>
        Each dot is the average reading level of Kite&apos;s answers at one grade. The line above it is the most that grade
        band allows.{" "}
        {over.length === 0 ? "Every grade stayed under its line." : `Grades ${over.map((r) => r.grade).join(", ")} went over.`}
      </p>
      <div className={styles.chart}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Reading level of Kite's answers by grade, against each band's ceiling. The table below has the numbers.">
          {[0, 4, 8, 12].map((v) => (
            <g key={v}>
              <line x1={M.left} x2={W - M.right} y1={y(v)} y2={y(v)} className={styles.grid} />
              <text x={M.left - 8} y={y(v)} className={styles.axis} textAnchor="end" dominantBaseline="middle">
                {v}
              </text>
            </g>
          ))}
          {ceilings.map(([band, max]) => {
            const [a, b] = BANDS[band] ?? [0, 0];
            const from = Math.max(a - 0.5, X0);
            return (
              <g key={band}>
                <line x1={x(from)} x2={x(b + 0.5)} y1={y(max)} y2={y(max)} className={styles.ceiling} />
                <text x={x(from) + 4} y={y(max) - 6} className={styles.axis}>
                  {band} limit
                </text>
              </g>
            );
          })}
          {rows.map((r) => (
            <g key={r.grade} className={styles.dot}>
              <circle cx={x(r.grade)} cy={y(r.fk_mean)} r={6} />
              <circle cx={x(r.grade)} cy={y(r.fk_mean)} r={12} fill="transparent">
                <title>{`Grade ${r.grade}: reading level ${r.fk_mean.toFixed(1)}, limit ${r.fk_max} (${r.n} answers)`}</title>
              </circle>
            </g>
          ))}
          {Array.from({ length: 12 }, (_, i) => i + 1).map((g) => (
            <text key={g} x={x(g)} y={H - 8} textAnchor="middle" className={styles.axis}>
              {g}
            </text>
          ))}
        </svg>
        <details className={styles.more}>
          <summary>Show as a table</summary>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Grade</th>
                <th scope="col">Average reading level</th>
                <th scope="col">Band limit</th>
                <th scope="col">Answers</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.grade}>
                  <th scope="row">{r.grade}</th>
                  <td>{r.fk_mean.toFixed(1)}</td>
                  <td>{r.fk_max}</td>
                  <td>{r.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
    </section>
  );
}
