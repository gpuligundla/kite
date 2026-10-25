"use client";

import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { Tip, useTip } from "./Tip";
import { curiosityRadar, percent, type DashboardView, type Grade, type Radar } from "./model";
import styles from "./parent.module.css";

const W = 520;
const H = 400;
const CX = W / 2;
const CY = H / 2;
const RAD = 135;
const RINGS = [0.1, 0.25, 0.5, 0.75];
const EASE_OUT = [0.23, 1, 0.32, 1] as const;

const angle = (i: number, n: number) => -Math.PI / 2 + (2 * Math.PI * i) / n;
// The radius is the square root of the share, so a polygon's area tracks the share and small interests stay visible.
const r = (share: number, max: number) => RAD * Math.sqrt(share / max);
const point = (i: number, n: number, rad: number) => [CX + rad * Math.cos(angle(i, n)), CY + rad * Math.sin(angle(i, n))] as const;
const shape = (values: number[], max: number) => values.map((v, i) => point(i, values.length, r(v, max)).join(",")).join(" ");

export function CuriosityChart({ view, grade }: { view: DashboardView; grade: Grade }) {
  const reduce = useReducedMotion();
  const [pick, setPick] = useState<number | null>(null);
  const radar = curiosityRadar(view, grade, pick);
  const { axes, max, compare } = radar;
  const n = axes.length;
  const { box, tip, show, hide } = useTip<HTMLDivElement>();

  return (
    <section className={styles.radarSection} aria-labelledby="curious-h">
      <div>
        <h2 id="curious-h">What she&apos;s curious about</h2>
        <p className={styles.mapLede}>{insight(radar, grade)}</p>
        <p className={styles.mapLede}>Each point is a topic&apos;s share of her questions, follow-ups and return visits in one school year.</p>
        {n > 0 && (
          <ul className={styles.radarKey}>
            <li>
              <svg viewBox="0 0 24 8" aria-hidden>
                <line x1="1" y1="4" x2="23" y2="4" className={styles.keyNow} />
              </svg>
              Grade {grade}
            </li>
            {radar.earlier.length > 0 && (
              <li>
                <svg viewBox="0 0 24 8" aria-hidden>
                  <line x1="1" y1="4" x2="23" y2="4" className={styles.keyThen} />
                </svg>
                <label htmlFor="compare">Compared with</label>
                <select id="compare" value={compare ?? ""} onChange={(e) => setPick(Number(e.target.value))} className={styles.select}>
                  {radar.earlier.map((g) => (
                    <option key={g} value={g}>
                      grade {g}
                    </option>
                  ))}
                </select>
              </li>
            )}
          </ul>
        )}
      </div>
      {n === 0 ? (
        <p className={styles.mapLede}>No questions yet at this grade.</p>
      ) : (
        <div ref={box} className={styles.radar}>
          <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`Share of her curiosity by topic in grade ${grade}${compare ? ` and grade ${compare}` : ""}. The table below has the numbers.`}>
            {RINGS.filter((v) => v <= max).map((v) => (
              <g key={v}>
                <polygon points={shape(axes.map(() => v), max)} className={styles.ring} />
                <text x={CX - 6} y={CY - r(v, max) + 4} textAnchor="end" className={styles.ringLabel}>
                  {percent(v)}
                </text>
              </g>
            ))}
            {axes.map((_, i) => {
              const [x, y] = point(i, n, RAD);
              return <line key={i} x1={CX} y1={CY} x2={x} y2={y} className={styles.spoke} />;
            })}
            {compare !== null && <polygon points={shape(axes.map((a) => a.then ?? 0), max)} className={styles.then} />}
            <motion.polygon
              key={grade}
              points={shape(axes.map((a) => a.now), max)}
              className={styles.now}
              style={{ transformBox: "fill-box", transformOrigin: "center" }}
              initial={{ opacity: 0, transform: reduce ? "scale(1)" : "scale(0.95)" }}
              animate={{ opacity: 1, transform: "scale(1)" }}
              transition={{ duration: 0.26, ease: EASE_OUT }}
            />
            {axes.map((a, i) => {
              const [x, y] = point(i, n, r(a.now, max));
              const [lx, ly] = point(i, n, RAD + 18);
              const cos = Math.cos(angle(i, n));
              const anchor = cos > 0.3 ? "start" : cos < -0.3 ? "end" : "middle";
              const label = `${a.name}: ${percent(a.now)} in grade ${grade}${a.then !== null ? `, ${percent(a.then)} in grade ${compare}` : ""}`;
              return (
                <g
                  key={a.topic}
                  className={styles.radarAxis}
                  tabIndex={0}
                  role="img"
                  aria-label={label}
                  onPointerEnter={(e) => show(e.currentTarget.querySelector("circle")!, <AxisTip a={a} grade={grade} compare={compare} />)}
                  onPointerLeave={hide}
                  onFocus={(e) => show(e.currentTarget.querySelector("circle")!, <AxisTip a={a} grade={grade} compare={compare} />)}
                  onBlur={hide}
                >
                  <line x1={CX} y1={CY} x2={lx} y2={ly} className={styles.axisHit} />
                  <circle cx={x} cy={y} r={5} className={styles.radarDot} />
                  <text x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle" className={styles.axisLabel}>
                    {lines(a.name).map((t, k, all) => (
                      <tspan key={k} x={lx} dy={k === 0 ? `${-(all.length - 1) * 0.55}em` : "1.1em"}>
                        {t}
                      </tspan>
                    ))}
                  </text>
                </g>
              );
            })}
          </svg>
          <Tip tip={tip} />
        </div>
      )}
      {n > 0 && (
        <details className={styles.mapMore}>
          <summary>Show as a table</summary>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Topic</th>
                <th scope="col">Grade {grade}</th>
                {compare !== null && <th scope="col">Grade {compare}</th>}
              </tr>
            </thead>
            <tbody>
              {axes.map((a) => (
                <tr key={a.topic}>
                  <th scope="row">{a.name}</th>
                  <td>{percent(a.now)}</td>
                  {a.then !== null && <td>{percent(a.then)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}

function AxisTip({ a, grade, compare }: { a: Radar["axes"][number]; grade: number; compare: number | null }) {
  return (
    <>
      <strong>{percent(a.now)}</strong>
      <span>
        of her questions in grade {grade} were about {a.name.toLowerCase()}
        {a.then !== null && `, against ${percent(a.then)} in grade ${compare}`}.
      </span>
    </>
  );
}

/** Long topic names break at the space nearest their middle so side labels stay inside the panel. */
function lines(name: string): string[] {
  if (name.length <= 12) return [name];
  const mid = name.length / 2;
  const at = [...name].reduce((best, ch, i) => (ch === " " && Math.abs(i - mid) < Math.abs(best - mid) ? i : best), -1);
  return at < 0 ? [name] : [name.slice(0, at), name.slice(at + 1)];
}

/** The chart's headline says what changed, not what the chart is. */
function insight({ axes, compare }: Radar, grade: number): string {
  if (axes.length === 0) return "Not enough questions yet to see a pattern.";
  const top = axes[0];
  if (compare === null) return `In grade ${grade}, ${percent(top.now)} of her questions were about ${top.name.toLowerCase()}.`;
  const mover = [...axes].sort((x, y) => Math.abs(y.now - (y.then ?? 0)) - Math.abs(x.now - (x.then ?? 0)))[0];
  const verb = mover.now >= (mover.then ?? 0) ? "grew" : "fell";
  return `Since grade ${compare}, ${mover.name.toLowerCase()} ${verb} from ${percent(mover.then ?? 0)} to ${percent(mover.now)} of her questions.`;
}
