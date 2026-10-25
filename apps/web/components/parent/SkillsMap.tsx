"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Tip, useTip } from "./Tip";
import { LEVELS, LEVEL_WORDS, knowledgeMap, type Cell, type Comb, type DashboardView, type Level } from "./model";
import styles from "./parent.module.css";

const R = 24;
const W = Math.sqrt(3) * R;
const hex = (rad: number) =>
  `M${[0, 1, 2, 3, 4, 5]
    .map((k) => {
      const a = (Math.PI / 180) * (60 * k - 90);
      return `${(rad * Math.cos(a)).toFixed(2)},${(rad * Math.sin(a)).toFixed(2)}`;
    })
    .join("L")}Z`;
const CELL = hex(R - 1.5);
// Hexes of radius R tile the plane, so the backing layer hides the halo everywhere but the comb's outer edge.
const BACK = hex(R + 0.5);
const HALO = hex(R + 3.5);
const KITE = "M0,-6L4.5,0L0,6L-4.5,0Z";
const PAD = 5;
const EASE_OUT = [0.23, 1, 0.32, 1] as const;

const center = (c: Cell) => [W * (c.q + c.r / 2), 1.5 * R * c.r] as const;
const cellWords = (c: Cell) => (c.level ? LEVEL_WORDS[c.level] : "Not explored yet");

/** Levels are for grown-ups only; the kid side never shows them. */
export function SkillsMap({ view }: { view: DashboardView }) {
  const combs = knowledgeMap(view);
  const cells = combs.flatMap((comb) => comb.cells.map((cell) => ({ comb, cell })));
  const { box, tip, show, hide } = useTip<HTMLDivElement>();
  const [active, setActive] = useState(0);
  const refs = useRef(new Map<string, SVGGElement>());

  // One tab stop for the whole map; arrow keys walk the ideas in reading order.
  const onKey = (e: KeyboardEvent) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: -Infinity, End: Infinity }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const next = Math.min(Math.max(active + step, 0), cells.length - 1);
    setActive(next);
    refs.current.get(cells[next].cell.id)?.focus();
  };

  return (
    <section className={styles.mapSection} aria-labelledby="skills-h">
      <div className={styles.mapHead}>
        <div>
          <h2 id="skills-h">Knowledge map</h2>
          <p className={styles.mapLede}>
            Each hexagon is one idea, grouped by topic: her first idea in the middle, later ones spiralling out. Only
            what she does counts: teaching it back, a check question, or a game.
          </p>
        </div>
        <Legend />
      </div>
      {combs.length === 0 && <p className={styles.mapLede}>Nothing shown yet at this grade.</p>}
      <div ref={box} className={styles.combs} onKeyDown={onKey}>
        <AnimatePresence initial={false}>
          {combs.map((comb, ci) => (
            <CombView
              key={comb.topic}
              comb={comb}
              order={ci}
              tabbable={(id) => cells[active]?.cell.id === id}
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
      <details className={styles.mapMore}>
        <summary>Show the map as a table</summary>
        <table className={styles.table}>
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
                <td>{comb.name}{comb.strength && " (strength)"}</td>
                <th scope="row">{cell.name}</th>
                <td>{cell.grade === 0 ? "K" : cell.grade}</td>
                <td>{cellWords(cell)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
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
  const xs = comb.cells.map((c) => center(c)[0]);
  const ys = comb.cells.map((c) => center(c)[1]);
  const x0 = Math.min(...xs) - W / 2 - PAD;
  const y0 = Math.min(...ys) - R - PAD;
  const w = Math.max(...xs) + W / 2 + PAD - x0;
  const h = Math.max(...ys) + R + PAD - y0;

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
      <svg viewBox={`${x0} ${y0} ${w} ${h}`} style={{ width: `calc(${w}px * var(--hex-scale))` }} role="group" aria-label={`${comb.name}: ${comb.solid} of ${comb.shown} ideas solid`}>
        <motion.g initial={false} animate={{ opacity: comb.strength ? 1 : 0 }} transition={{ duration: 0.26, ease: EASE_OUT, delay: comb.strength ? 0.18 : 0 }}>
          {comb.cells.map((c) => (
            <path key={c.id} d={HALO} transform={`translate(${center(c).join(" ")})`} className={styles.halo} />
          ))}
        </motion.g>
        {comb.cells.map((c) => (
          <path key={c.id} d={BACK} transform={`translate(${center(c).join(" ")})`} className={styles.back} />
        ))}
        {comb.cells.map((c, i) => (
          <g
            key={c.id}
            ref={(el) => register(c.id, el)}
            transform={`translate(${center(c).join(" ")})`}
            className={styles.cell}
            tabIndex={tabbable(c.id) ? 0 : -1}
            role="img"
            aria-label={`${c.name}, ${comb.name}: ${cellWords(c)}`}
            onPointerEnter={(e) => onShow(e.currentTarget, c)}
            onPointerLeave={onHide}
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
                  <path d={CELL} style={{ fill: `var(--lv-${c.level})` }} />
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
    <svg viewBox="-12 -13 24 26" className={styles.swatchHex} aria-hidden>
      <path d={hex(11)} className={level ? undefined : styles.cellEmpty} style={level ? { fill: `var(--lv-${level})` } : undefined} />
      {level === "can_teach" && <path d="M0,-4L3,0L0,4L-3,0Z" className={styles.cellMark} />}
    </svg>
  );
}

function Legend() {
  return (
    <ul className={styles.mapKey} aria-label="Key">
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
        <svg viewBox="-12 -13 24 26" className={styles.swatchHex} aria-hidden>
          <path d={hex(11)} className={styles.halo} />
          <path d={hex(8.5)} className={styles.back} />
        </svg>
        Strength
      </li>
    </ul>
  );
}
