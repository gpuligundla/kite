"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useBrain, useBrainEvents } from "@/lib/brain";
import { Alerts } from "@/components/parent/Alerts";
import { Contacts } from "@/components/parent/Contacts";
import { GradeSlider } from "@/components/parent/GradeSlider";
import { Masthead } from "@/components/parent/Masthead";
import { Movies } from "@/components/parent/Movies";
import { Overview } from "@/components/parent/Overview";
import { Policy } from "@/components/parent/Policy";
import { Trust } from "@/components/parent/Trust";
import { KID, type Alert, type DashboardView, type Grade, type PolicyAction } from "@/components/parent/model";
import styles from "@/components/parent/parent.module.css";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "topics", label: "Sensitive topics" },
  { id: "contacts", label: "Contacts" },
  { id: "movies", label: "Movies" },
  { id: "trust", label: "Trust" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const parseTab = (s: string | null): Tab => TABS.find((t) => t.id === s)?.id ?? "overview";
const parseGrade = (s: string | null): Grade => {
  const g = Number(s ?? KID.grade);
  return (Number.isInteger(g) && g >= KID.firstGrade && g <= KID.grade ? g : KID.grade) as Grade;
};

/**
 * Every dashboard read writes an access receipt, so reads happen only when the grade settles on one
 * not seen yet, or a new alert arrives. Never on a timer.
 */
export function ParentScreen() {
  const brain = useBrain("parent");
  const params = useSearchParams();
  const grade = parseGrade(params.get("grade"));
  const tab = parseTab(params.get("tab"));

  const cache = useRef(new Map<Grade, DashboardView>());
  const [shown, setShown] = useState<{ grade: Grade; view: DashboardView } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [policy, setPolicy] = useState<Record<string, PolicyAction> | null>(null);
  const [live, setLive] = useState<Alert[]>([]);
  const [opened, setOpened] = useState<ReadonlySet<Tab>>(() => new Set([tab]));

  useEffect(() => {
    const hit = cache.current.get(grade);
    if (hit) return setShown({ grade, view: hit });
    let current = true;
    // A dragged slider passes through every grade; only the one it rests on is read.
    const wait = setTimeout(() => {
      brain.dashboard(grade).then(
        (view) => {
          cache.current.set(grade, view);
          setPolicy((p) => p ?? view.policy);
          if (current) {
            setShown({ grade, view });
            setError(null);
          }
        },
        (err: Error) => current && setError(`The dashboard didn't load: ${err.message}. Check the brain is running, then reload.`),
      );
    }, 220);
    return () => {
      current = false;
      clearTimeout(wait);
    };
  }, [brain, grade, reload]);

  useBrainEvents(brain, (e) => {
    if (e.type !== "alert" || live.some((a) => a.alert_id === e.alert_id)) return;
    const alert: Alert = { alert_id: e.alert_id, kinds: e.kinds, at: e.at, lat: e.lat, lng: e.lng };
    setLive((list) => (list.some((a) => a.alert_id === alert.alert_id) ? list : [alert, ...list]));
    // A past grade's dashboard ends at that school year, so a live alert can only change the current one.
    // The stream also replays recent alerts on connect; those are already in it and cost no reread.
    if (shown?.grade === KID.grade && !shown.view.alerts.some((a) => a.alert_id === e.alert_id)) {
      cache.current.delete(KID.grade);
      setReload((n) => n + 1);
    }
  });

  const go = (next: { grade?: Grade; tab?: Tab }) => {
    const q = new URLSearchParams({ grade: String(next.grade ?? grade), tab: next.tab ?? tab });
    window.history.replaceState(null, "", `?${q}`);
    if (next.tab) setOpened((s) => new Set(s).add(next.tab!));
  };

  const alerts = [...new Map([...(shown?.view.alerts ?? []), ...live].map((a) => [a.alert_id, a])).values()].sort(
    (a, b) => Date.parse(b.at) - Date.parse(a.at),
  );

  return (
    <main className={`grown ${styles.page}`}>
      <Masthead />
      <div className={styles.frame}>
        <header className={styles.who}>
          <h1>{KID.name}</h1>
          <p className={styles.quiet}>In grade {KID.grade} now</p>
        </header>

        <Alerts alerts={alerts} name={KID.name} />

        <nav className={styles.tabs} role="tablist" aria-label="Sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              className={styles.tab}
              onClick={() => go({ tab: t.id })}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {error && <p className={styles.error} role="alert">{error}</p>}

        {/* Panels are plain divs so each section inside is the nearest section to its own heading. */}
        <div id="panel-overview" role="tabpanel" aria-labelledby="tab-overview" hidden={tab !== "overview"}>
          <GradeSlider grade={grade} onChange={(g) => go({ grade: g })} />
          {shown ? (
            <Overview view={shown.view} grade={shown.grade} stale={shown.grade !== grade} alerts={alerts} />
          ) : (
            !error && <p className={styles.quiet}>Loading {KID.name}&apos;s grade {grade}…</p>
          )}
        </div>
        <div id="panel-topics" role="tabpanel" aria-labelledby="tab-topics" hidden={tab !== "topics"}>
          {policy && <Policy brain={brain} family={KID.family} name={KID.name} policy={policy} onChange={(set) => setPolicy((p) => p && set(p))} />}
        </div>
        {(["contacts", "movies", "trust"] as const).map(
          (id) =>
            opened.has(id) && (
              <div key={id} id={`panel-${id}`} role="tabpanel" aria-labelledby={`tab-${id}`} hidden={tab !== id}>
                {id === "contacts" && <Contacts brain={brain} name={KID.name} />}
                {id === "movies" && <Movies brain={brain} name={KID.name} />}
                {id === "trust" && <Trust brain={brain} />}
              </div>
            ),
        )}
      </div>
    </main>
  );
}
