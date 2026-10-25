"use client";

import { useRef, useState, type ReactNode } from "react";
import styles from "./parent.module.css";

interface TipState {
  x: number;
  y: number;
  content: ReactNode;
}

const EDGE = 96;

/** One hover-or-focus readout per chart, placed above the mark that asked for it. */
export function useTip<E extends HTMLElement>() {
  const box = useRef<E>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const show = (target: Element, content: ReactNode) => {
    if (!box.current) return;
    const b = box.current.getBoundingClientRect();
    const r = target.getBoundingClientRect();
    const x = Math.min(Math.max(r.left + r.width / 2 - b.left, EDGE), b.width - EDGE);
    setTip({ x, y: r.top - b.top, content });
  };
  return { box, tip, show, hide: () => setTip(null) };
}

/** The marks carry their own accessible labels, so the readout is hidden from screen readers. */
export function Tip({ tip }: { tip: TipState | null }) {
  if (!tip) return null;
  return (
    <div className={styles.tip} style={{ left: tip.x, top: tip.y }} aria-hidden>
      {tip.content}
    </div>
  );
}
