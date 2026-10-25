"use client";

import { motion } from "motion/react";
import s from "./os.module.css";

const COLORS = ["var(--kite-red)", "var(--kite-yellow)", "var(--tail-teal)", "var(--sky-deep)"];
const PIECES = Array.from({ length: 12 }, (_, i) => {
  const angle = (i / 12) * Math.PI * 2 - Math.PI / 2;
  const reach = 90 + (i % 3) * 28;
  return { x: Math.cos(angle) * reach, y: Math.sin(angle) * reach * 0.8, color: COLORS[i % COLORS.length], delay: (i % 4) * 0.04 };
});

/** Little kites thrown out from Kite. Only for the delight moments in DESIGN.md, so it's allowed to run long. */
export function Burst() {
  return (
    <span className={s.burst} aria-hidden="true">
      {PIECES.map((p, i) => (
        <motion.i
          key={i}
          style={{ background: p.color }}
          initial={{ opacity: 1, transform: "translate(0px, 0px) rotate(45deg) scale(0.6)" }}
          animate={{ opacity: 0, transform: `translate(${p.x}px, ${p.y}px) rotate(${45 + p.x}deg) scale(1)` }}
          transition={{ duration: 1.1, delay: p.delay, ease: [0.23, 1, 0.32, 1] }}
        />
      ))}
    </span>
  );
}
