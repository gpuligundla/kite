"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { Glyph } from "@/components/os/Glyph";
import s from "./shell.module.css";

/**
 * An app, open: a glass window over the sky with a title, a way back and a way out. Back walks back inside the app
 * and leaves it from its first page; close always goes home.
 */
export function Window({ title, icon, tone, onBack, onClose, actions, label, children, className }: {
  title: string;
  icon: ReactNode;
  /** The app icon's gradient, echoed in the title bar. */
  tone: string;
  onBack: () => void;
  onClose: () => void;
  actions?: ReactNode;
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.section
      className={`${s.window} ${className ?? ""}`}
      aria-label={label ?? title}
      initial={{ opacity: 0, transform: reduce ? "none" : "translateY(14px) scale(0.97)" }}
      animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
      transition={{ duration: 0.26, ease: [0.23, 1, 0.32, 1] }}
    >
      <header className={s.titleBar}>
        <button type="button" className={s.barButton} onClick={onBack} aria-label="Back">
          <Glyph name="back" size={20} />
        </button>
        <span className={s.titleIcon} data-tone={tone} aria-hidden="true">
          {icon}
        </span>
        <h1 className={s.title}>{title}</h1>
        <div className={s.titleActions}>
          {actions}
          <button type="button" className={s.barButton} onClick={onClose} aria-label={`Close ${title}`}>
            <Glyph name="close" size={20} />
          </button>
        </div>
      </header>
      <div className={s.windowBody}>{children}</div>
    </motion.section>
  );
}
