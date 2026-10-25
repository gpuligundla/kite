"use client";

import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { KiteMark } from "@/components/kit/KiteMark";
import { useBrain, useBrainEvents } from "@/lib/brain";
import { AccessLog } from "./AccessLog";
import { Protocol } from "./Protocol";
import { Reports } from "./Reports";
import { StudentProfile } from "./StudentProfile";
import type { CaseChange, Report, Student } from "./model";
import styles from "./counselor.module.css";

const TABS = [
  { id: "reports", label: "Reports" },
  { id: "student", label: "Student" },
  { id: "protocol", label: "Protocol" },
  { id: "access", label: "Access log" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const onHash = (change: () => void) => {
  window.addEventListener("hashchange", change);
  return () => window.removeEventListener("hashchange", change);
};

/** The tab lives in the URL hash, so a reload stays put. */
function useHashTab(): [Tab, (t: Tab) => void] {
  const hash = useSyncExternalStore(onHash, () => window.location.hash.slice(1), () => "");
  return [TABS.find((t) => t.id === hash)?.id ?? "reports", (t) => void (window.location.hash = t)];
}

/**
 * Every report read writes a receipt per report, so reports load once, and again only when a new one arrives on the
 * stream. A case change patches the one report it touched.
 */
export function CounselorConsole() {
  const brain = useBrain("counselor");
  const [tab, setTab] = useHashTab();
  const reduce = useReducedMotion();
  const [reports, setReports] = useState<Report[] | null>(null);
  const [student, setStudent] = useState<Student | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    brain.get<Report[]>("/counselor/alerts").then(
      (list) => {
        if (!current) return;
        setReports(list);
        setError(null);
        setSelected((id) => (id && list.some((r) => r.alert_id === id) ? id : (list.find((r) => r.status === "new") ?? list[0])?.alert_id ?? null));
      },
      (err: Error) => current && setError(`Reports didn't load: ${err.message}. Check that this device is paired, then reload.`),
    );
    return () => {
      current = false;
    };
  }, [brain, reload]);

  useEffect(() => {
    let current = true;
    brain.get<Student>("/counselor/student").then(
      (s) => current && setStudent(s),
      (err: Error) => current && setError(`The student profile didn't load: ${err.message}. Reload to try again.`),
    );
    return () => {
      current = false;
    };
  }, [brain]);

  // The stream replays recent events on connect; only a report not in the list costs a reread.
  useBrainEvents(brain, (e) => {
    if (e.type === "alert" && reports && !reports.some((r) => r.alert_id === e.alert_id)) setReload((n) => n + 1);
  });

  const changed = (id: string, history: CaseChange[]) =>
    setReports((list) => list?.map((r) => (r.alert_id === id ? { ...r, history, status: history.at(-1)?.status ?? "new" } : r)) ?? null);
  const open = (id: string) => {
    setSelected(id);
    setTab("reports");
  };

  const name = student?.name ?? "the student";
  const fresh = reports?.filter((r) => r.status === "new") ?? [];

  return (
    <main className={`grown ${styles.page}`}>
      <header className={`glass ${styles.bar}`}>
        <div className={styles.brand}>
          <KiteMark size={18} label="" />
          <span className={styles.wordmark}>Kite</span>
          <span className={styles.role}>Counselor</span>
        </div>
        <LayoutGroup id="counselor-tabs">
          <nav className={styles.tabs} aria-label="Sections">
            {TABS.map((t) => (
              <a
                key={t.id}
                href={`#${t.id}`}
                className={styles.tab}
                aria-current={tab === t.id ? "page" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  setTab(t.id);
                }}
              >
                {tab === t.id && (
                  <motion.span
                    layoutId="tab-pill"
                    className={styles.tabPill}
                    transition={reduce ? { duration: 0 } : { type: "spring", bounce: 0.15, duration: 0.35 }}
                  />
                )}
                <span className={styles.tabLabel}>{t.label}</span>
              </a>
            ))}
          </nav>
        </LayoutGroup>
        <div className={styles.who}>
          {student && (
            <span className={styles.whoName}>
              {student.name}
              <span className={styles.whoGrade}>Grade {student.grade}</span>
            </span>
          )}
          {fresh.length > 0 && (
            <button type="button" className={styles.newPill} onClick={() => open(fresh[0].alert_id)}>
              <span className={styles.newDot} aria-hidden />
              {fresh.length === 1 ? "1 new report" : `${fresh.length} new reports`}
            </button>
          )}
        </div>
      </header>

      <div className={styles.frame}>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <motion.div
          key={tab}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
        >
          {tab === "reports" && (
            <Reports brain={brain} reports={reports} name={name} selected={selected} onSelect={setSelected} onChanged={changed} />
          )}
          {tab === "student" && <StudentProfile student={student} reports={reports} onOpen={open} />}
          {tab === "protocol" && <Protocol name={name} reports={reports} />}
          {tab === "access" && <AccessLog brain={brain} reports={reports} name={name} />}
        </motion.div>
      </div>
    </main>
  );
}
