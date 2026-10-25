"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Tip, useTip } from "./Tip";
import { LEVELS, LEVEL_WORDS, knowledgeMap, type Cell, type Comb, type DashboardView, type Level } from "./model";
import styles from "./map.module.css";

const R = 26;
const W = Math.sqrt(3) * R;
const hex = (rad: number) =>
  `M${[0, 1, 2, 3, 4, 5]
    .map((k) => {
      const a = (Math.PI / 180) * (60 * k - 90);
      return `${(rad * Math.cos(a)).toFixed(2)},${(rad * Math.sin(a)).toFixed(2)}`;
    })
    .join("L")}Z`;
const CELL = hex(R - 2);
const HALO = hex(R + 3);
// Hexes of radius R tile the plane, so a backing layer hides the halo everywhere but the comb's outer edge.
const BACK = hex(R + 0.5);
const KITE = "M0,-7L5,0L0,7L-5,0Z";
const PAD = 12;
const EASE_OUT = [0.23, 1, 0.32, 1] as const;

const center = (c: Cell) => [W * (c.q + c.r / 2), 1.5 * R * c.r] as const;
const at = (c: Cell) => `translate(${center(c).join(" ")})`;
const cellWords = (c: Cell) => (c.level ? LEVEL_WORDS[c.level] : "Not explored yet");
const fill = (level: Level) => `url(#lv-${level})`;

function box(comb: Comb) {
  const xs = comb.cells.map((c) => center(c)[0]);
  const ys = comb.cells.map((c) => center(c)[1]);
  const x0 = Math.min(...xs) - W / 2 - PAD;
  const y0 = Math.min(...ys) - R - PAD;
  return { x0, y0, w: Math.max(...xs) + W / 2 + PAD - x0, h: Math.max(...ys) + R + PAD - y0 };
}

/** One radial gradient per level, shared by every comb on the page: each lit cell glows from its center. */
export function LevelGradients() {
  return (
    <svg width="0" height="0" className={styles.defs} aria-hidden>
      <defs>
        {LEVELS.map((l) => (
          <radialGradient key={l} id={`lv-${l}`} cx="50%" cy="38%" r="70%">
            {/* A stop-color attribute can't read a CSS variable; a style can. */}
            <stop offset="0%" style={{ stopColor: `var(--lv-${l}-hi)` }} />
            <stop offset="100%" style={{ stopColor: `var(--lv-${l})` }} />
          </radialGradient>
        ))}
      </defs>
    </svg>
  );
}

/** A topic's comb at a glance, for the Overview. Needs <LevelGradients /> somewhere on the page. */
export function MiniComb({ comb, size }: { comb: Comb; size: number }) {
  const { x0, y0, w, h } = box(comb);
  return (
    <svg viewBox={`${x0} ${y0} ${w} ${h}`} width={size} height={(size * h) / w} className={styles.mini} data-strength={comb.strength} aria-hidden>
      {comb.strength && comb.cells.map((c) => <path key={c.id} d={HALO} transform={at(c)} className={styles.halo} />)}
      {comb.strength && comb.cells.map((c) => <path key={c.id} d={BACK} transform={at(c)} className={styles.back} />)}
      {comb.cells.map((c) => (
        <path key={c.id} d={CELL} transform={at(c)} className={c.level ? undefined : styles.cellEmpty} style={c.level ? { fill: fill(c.level) } : undefined} />
      ))}
    </svg>
  );
}

/** Levels are for grown-ups only; the kid side never shows them. */
export function SkillsMap({ view }: { view: DashboardView }) {
  const combs = knowledgeMap(view);
  const cells = combs.flatMap((comb) => comb.cells.map((cell) => ({ comb, cell })));
  const { box: tipBox, tip, show, hide } = useTip<HTMLDivElement>();
  const [active, setActive] = useState(0);
  const refs = useRef(new Map<string, SVGGElement>());

  // One tab stop for the whole map; arrow keys walk the ideas in reading order.
  const onKey = (e: KeyboardEvent) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: -Infinity, End: Infinity }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const next = Math.min(Math.max(Math.min(active, cells.length - 1) + step, 0), cells.length - 1);
    setActive(next);
    refs.current.get(cells[next].cell.id)?.focus();
  };

  return (
    <div className={styles.map}>
      {combs.length === 0 && <p className={styles.empty}>Nothing shown yet at this grade. Each idea she teaches back, answers or plays lights a hexagon here.</p>}
      <div ref={tipBox} className={styles.combs} onKeyDown={onKey}>
        <AnimatePresence initial={false}>
          {combs.map((comb, ci) => (
            <CombView
              key={comb.topic}
              comb={comb}
              order={ci}
              tabbable={(id) => cells[Math.min(active, cells.length - 1)]?.cell.id === id}
              register={(id, el) => (el ? refs.current.set(id, el) : refs.current.delete(id))}
              onShow={(el, cell) => {
                setActive(cells.findIndex((c) => c.cell.id === cell.id));
                show(el, <CellTip cell={cell} comb={comb} />);
              }}
              onHide={hide}
            />
          ))}
        </AnimatePresence>
        <Tip tip={tip} />
      </div>
      <details className={styles.asTable}>
        <summary>Show the map as a table</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Topic</th>
              <th scope="col">Idea</th>
              <th scope="col">School grade</th>
              <th scope="col">Level</th>
            </tr>
          </thead>
          <tbody>
            {cells.map(({ comb, cell }) => (
              <tr key={cell.id}>
                <td>
                  {comb.name}
                  {comb.strength && " (strength)"}
                </td>
                <th scope="row">{cell.name}</th>
                <td>{cell.grade === 0 ? "K" : cell.grade}</td>
                <td>{cellWords(cell)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function CombView({
  comb, order, tabbable, register, onShow, onHide,
}: {
  comb: Comb;
  order: number;
  tabbable: (id: string) => boolean;
  register: (id: string, el: SVGGElement | null) => void;
  onShow: (el: Element, cell: Cell) => void;
  onHide: () => void;
}) {
  const reduce = useReducedMotion();
  // The comb fills from its center outward when it first appears; later level changes answer the slider at once.
  const first = useRef(true);
  useEffect(() => {
    first.current = false;
  }, []);
  const { x0, y0, w, h } = box(comb);

  return (
    <motion.figure
      className={styles.comb}
      layout={reduce ? false : "position"}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.26, ease: EASE_OUT }}
      data-strength={comb.strength}
    >
      <svg
        viewBox={`${x0} ${y0} ${w} ${h}`}
        style={{ width: `calc(${w}px * var(--hex-scale))` }}
        role="group"
        aria-label={`${comb.name}: ${comb.solid} of ${comb.shown} ideas solid`}
      >
        <motion.g initial={false} animate={{ opacity: comb.strength ? 1 : 0 }} transition={{ duration: 0.26, ease: EASE_OUT, delay: comb.strength ? 0.18 : 0 }}>
          {comb.cells.map((c) => (
            <path key={c.id} d={HALO} transform={at(c)} className={styles.halo} />
          ))}
          {comb.cells.map((c) => (
            <path key={`${c.id}-back`} d={BACK} transform={at(c)} className={styles.back} />
          ))}
        </motion.g>
        {comb.cells.map((c, i) => (
          <g
            key={c.id}
            ref={(el) => register(c.id, el)}
            transform={at(c)}
            className={styles.cell}
            tabIndex={tabbable(c.id) ? 0 : -1}
            role="img"
            aria-label={`${c.name}, ${comb.name}: ${cellWords(c)}`}
            onPointerEnter={(e) => onShow(e.currentTarget, c)}
            onPointerLeave={onHide}
            onClick={(e) => onShow(e.currentTarget, c)}
            onFocus={(e) => onShow(e.currentTarget, c)}
            onBlur={onHide}
          >
            <path d={CELL} className={styles.cellEmpty} />
            <AnimatePresence>
              {c.level && (
                <motion.g
                  key={c.level}
                  style={{ transformBox: "fill-box", transformOrigin: "center" }}
                  initial={{ opacity: 0, transform: reduce ? "scale(1)" : "scale(0.9)" }}
                  animate={{ opacity: 1, transform: "scale(1)" }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.26, ease: EASE_OUT, delay: reduce || !first.current ? 0 : Math.min(i, 10) * 0.04 + order * 0.05 }}
                >
                  <path d={CELL} style={{ fill: fill(c.level) }} data-level={c.level} className={styles.lit} />
                  {c.level === "can_teach" && <path d={KITE} className={styles.cellMark} />}
                </motion.g>
              )}
            </AnimatePresence>
            <path d={CELL} className={styles.cellRing} />
          </g>
        ))}
      </svg>
      <figcaption className={styles.combLabel}>
        <h3>{comb.name}</h3>
        <span>
          {comb.solid} of {comb.shown} solid
        </span>
        <AnimatePresence>
          {comb.strength && (
            <motion.span
              className={styles.strengthTag}
              initial={{ opacity: 0, transform: reduce ? "none" : "scale(0.95)" }}
              animate={{ opacity: 1, transform: "scale(1)" }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
            >
              Strength
            </motion.span>
          )}
        </AnimatePresence>
      </figcaption>
    </motion.figure>
  );
}

function CellTip({ cell, comb }: { cell: Cell; comb: Comb }) {
  return (
    <>
      <strong>{cell.name}</strong>
      <span>
        {cellWords(cell)}. {comb.name}, {cell.grade === 0 ? "kindergarten" : `grade ${cell.grade}`} idea.
      </span>
    </>
  );
}

function Swatch({ level }: { level: Level | null }) {
  return (
    <svg viewBox="-13 -14 26 28" className={styles.swatch} aria-hidden>
      <path d={hex(11)} className={level ? undefined : styles.cellEmpty} style={level ? { fill: fill(level) } : undefined} />
      {level === "can_teach" && <path d="M0,-4L3,0L0,4L-3,0Z" className={styles.cellMark} />}
    </svg>
  );
}

export function MapKey() {
  return (
    <ul className={styles.key} aria-label="Key">
      <li>
        <Swatch level={null} />
        Not explored
      </li>
      {LEVELS.map((l) => (
        <li key={l}>
          <Swatch level={l} />
          {LEVEL_WORDS[l]}
        </li>
      ))}
      <li>
        <svg viewBox="-13 -14 26 28" className={styles.swatch} aria-hidden>
          <path d={hex(12)} className={styles.halo} />
          <path d={hex(9)} className={styles.cellEmpty} />
        </svg>
        Strength
      </li>
    </ul>
  );
}
