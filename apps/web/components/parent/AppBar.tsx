"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, type CSSProperties, type KeyboardEvent } from "react";
import { KiteMark } from "@/components/kit/KiteMark";
import { Glyph } from "./Alerts";
import { KID, kindWords, leadKind, type Alert, type Grade } from "./model";
import styles from "./parent.module.css";

export const TABS = [
  { id: "overview", label: "Overview" },
  { id: "learning", label: "Learning" },
  { id: "moments", label: "Moments" },
  { id: "questions", label: "Big questions" },
  { id: "creations", label: "Creations" },
  { id: "safety", label: "Safety" },
  { id: "trust", label: "Trust" },
] as const;
export type Tab = (typeof TABS)[number]["id"];

const GRADES = Array.from({ length: KID.grade - KID.firstGrade + 1 }, (_, i) => (KID.firstGrade + i) as Grade);
const FAMILY = KID.family.charAt(0).toUpperCase() + KID.family.slice(1);

/** Who this is, and time travel: every grade-aware tab shows her as she was at the end of the chosen grade. */
export function AppBar({ grade, onGrade }: { grade: Grade; onGrade: (g: Grade) => void }) {
  const now = grade === KID.grade;
  const fill = (grade - KID.firstGrade) / (KID.grade - KID.firstGrade);
  return (
    <header className={styles.appbar}>
      <div className={styles.identity}>
        <span className={styles.mark}>
          <KiteMark size={22} label="Kite" />
        </span>
        <div>
          <h1>{KID.name}</h1>
          <p>
            Grade {KID.grade}, {FAMILY} family
          </p>
        </div>
      </div>
      <div className={styles.time}>
        <label htmlFor="grade" className={styles.timeFigure}>
          <span>Grade</span>
          <strong>{grade}</strong>
        </label>
        <div className={styles.track} style={{ "--fill": fill } as CSSProperties}>
          <input
            id="grade"
            type="range"
            min={KID.firstGrade}
            max={KID.grade}
            step={1}
            value={grade}
            aria-valuetext={`Grade ${grade}`}
            aria-describedby="grade-note"
            onChange={(e) => onGrade(Number(e.target.value) as Grade)}
          />
          <div className={styles.ticks} aria-hidden>
            {GRADES.map((g) => (
              <span key={g} data-on={g === grade}>
                {g}
              </span>
            ))}
          </div>
        </div>
        <p id="grade-note" className={styles.timeNote}>
          {now ? (
            "Now. Slide back through her years."
          ) : (
            <>
              As she was at the end of grade {grade}.{" "}
              <button className={styles.linkButton} onClick={() => onGrade(KID.grade)}>
                Back to now
              </button>
            </>
          )}
        </p>
      </div>
    </header>
  );
}

/** The tabs, with the alert beacon at the end so an unseen alert shows on every tab, even scrolled down. */
export function TabBar({
  tab, onTab, alerts, onAlerts,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  /** Unseen alerts, newest first. */
  alerts: Alert[];
  onAlerts: () => void;
}) {
  const reduce = useReducedMotion();
  const onKey = (e: KeyboardEvent) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = TABS[(TABS.findIndex((t) => t.id === tab) + step + TABS.length) % TABS.length].id;
    onTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  };
  // On a phone the tab row scrolls sideways; keep the open tab in it.
  useEffect(() => {
    document.getElementById(`tab-${tab}`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab]);
  const lead = alerts[0];
  return (
    <nav className={styles.tabbar} aria-label="Sections">
      <div role="tablist" className={styles.tabs} onKeyDown={onKey}>
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={styles.tab}
            onClick={() => onTab(t.id)}
          >
            {tab === t.id && (
              <motion.span
                layoutId="tab-indicator"
                className={styles.tabIndicator}
                transition={reduce ? { duration: 0 } : { type: "spring", bounce: 0.15, duration: 0.35 }}
              />
            )}
            <span className={styles.tabLabel}>{t.label}</span>
          </button>
        ))}
      </div>
      {lead && (
        <button
          className={styles.beacon}
          data-tone={leadKind(lead.kinds) === "sos" ? "urgent" : "care"}
          onClick={onAlerts}
          aria-label={`${alerts.length === 1 ? "One alert" : `${alerts.length} alerts`} you haven't seen. Open Safety.`}
        >
          <Glyph kind={leadKind(lead.kinds)} />
          <span>{kindWords(lead.kinds)}</span>
          {alerts.length > 1 && <span className={styles.beaconCount}>{alerts.length}</span>}
        </button>
      )}
    </nav>
  );
}
