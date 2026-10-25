"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useBrain, useBrainEvents } from "@/lib/brain";
import { AlertBar, useSeen } from "@/components/parent/Alerts";
import { AppBar, TABS, TabBar, type Tab } from "@/components/parent/AppBar";
import { Creations } from "@/components/parent/Creations";
import { Learning } from "@/components/parent/Learning";
import { Moments } from "@/components/parent/Moments";
import { Overview } from "@/components/parent/Overview";
import { Questions } from "@/components/parent/Questions";
import { Safety } from "@/components/parent/Safety";
import { LevelGradients } from "@/components/parent/SkillsMap";
import { Trust } from "@/components/parent/Trust";
import { KID, type Alert, type DashboardView, type Grade, type PolicyAction } from "@/components/parent/model";
import styles from "@/components/parent/parent.module.css";

const parseTab = (s: string): Tab => TABS.find((t) => t.id === s)?.id ?? "overview";
const parseGrade = (s: string | null): Grade => {
  const g = Number(s ?? KID.grade);
  return (Number.isInteger(g) && g >= KID.firstGrade && g <= KID.grade ? g : KID.grade) as Grade;
};

// The tab lives in the hash so a reload stays put; the server renders the Overview.
const onHash = (fn: () => void) => {
  window.addEventListener("hashchange", fn);
  return () => window.removeEventListener("hashchange", fn);
};
const useTab = () => useSyncExternalStore(onHash, () => parseTab(location.hash.slice(1)), () => "overview" as Tab);
function setUrl(grade: Grade, tab: Tab) {
  // State must be null: Next copies its own into it, and skips syncing useSearchParams for state it marked as its own.
  history.replaceState(null, "", `?grade=${grade}#${tab}`);
  // replaceState fires no hashchange, and the tab store listens for one.
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

/**
 * Every dashboard read writes an access receipt, so each grade is read at most once (again only after a new alert
 * changes the current one), and only once the slider settles on it. Never on a timer.
 */
export function ParentScreen() {
  const brain = useBrain("parent");
  const params = useSearchParams();
  const grade = parseGrade(params.get("grade"));
  const tab = useTab();

  // One read per grade, shared by everyone who asks for it.
  const reads = useRef(new Map<Grade, Promise<DashboardView>>());
  const read = (g: Grade) => {
    const hit = reads.current.get(g);
    if (hit) return hit;
    const next = brain.dashboard(g);
    reads.current.set(g, next);
    next.catch(() => reads.current.delete(g));
    return next;
  };
  const [shown, setShown] = useState<{ grade: Grade; view: DashboardView } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [policy, setPolicy] = useState<Record<string, PolicyAction> | null>(null);
  const [live, setLive] = useState<Alert[]>([]);
  // Alerts are about now, whatever grade the slider shows, so the current grade is always read. Null until it is.
  const [nowAlerts, setNowAlerts] = useState<Alert[] | null>(null);
  // A tab mounts the first time it opens and stays mounted, so going back to it never reads again.
  const [opened, setOpened] = useState<ReadonlySet<Tab>>(() => new Set(["overview"]));
  useEffect(() => setOpened((s) => (s.has(tab) ? s : new Set(s).add(tab))), [tab]);
  const seen = useSeen();

  useEffect(() => {
    read(KID.grade).then(
      (view) => {
        setNowAlerts(view.alerts);
        setPolicy((p) => p ?? view.policy);
      },
      () => {},
    );
  }, [brain, reload]);

  useEffect(() => {
    let current = true;
    // A dragged slider passes through every grade; only the one it rests on is read.
    const wait = setTimeout(
      () =>
        read(grade).then(
          (view) => {
            if (!current) return;
            setShown({ grade, view });
            setError(null);
          },
          (err: Error) => current && setError(`The dashboard didn't load: ${err.message}. Check the brain is running, then reload.`),
        ),
      reads.current.has(grade) ? 0 : 220,
    );
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
    if (nowAlerts && !nowAlerts.some((a) => a.alert_id === e.alert_id)) {
      reads.current.delete(KID.grade);
      setReload((n) => n + 1);
    }
  });

  const alerts = [...new Map([...(nowAlerts ?? []), ...live].map((a) => [a.alert_id, a])).values()].sort(
    (a, b) => Date.parse(b.at) - Date.parse(a.at),
  );

  const stale = shown !== null && shown.grade !== grade;
  const panels: Record<Tab, () => ReactNode> = {
    overview: () => shown && <Overview view={shown.view} grade={shown.grade} alerts={alerts} />,
    learning: () => shown && <Learning view={shown.view} grade={shown.grade} />,
    moments: () => shown && <Moments view={shown.view} grade={shown.grade} />,
    questions: () =>
      shown && (
        <Questions
          brain={brain}
          cards={shown.view.cards}
          grade={shown.grade}
          policy={policy ?? shown.view.policy}
          onPolicy={(set) => setPolicy((p) => set(p ?? shown.view.policy))}
        />
      ),
    creations: () => <Creations brain={brain} characters={shown?.view.profile.characters ?? []} />,
    safety: () => <Safety brain={brain} alerts={alerts} seen={seen} />,
    trust: () => <Trust brain={brain} />,
  };

  return (
    <main className={`grown ${styles.page}`}>
      <LevelGradients />
      <AppBar grade={grade} onGrade={(g) => setUrl(g, tab)} />
      <AlertBar alerts={alerts} seen={seen} onOpen={() => setUrl(grade, "safety")} />
      <TabBar tab={tab} onTab={(t) => setUrl(grade, t)} alerts={alerts.filter((a) => !seen.has(a.alert_id))} onAlerts={() => setUrl(grade, "safety")} />
      {error && <p className={styles.error} role="alert">{error}</p>}
      {!shown && !error && <p className={styles.loading}>Loading {KID.name}&apos;s grade {grade}…</p>}
      {/* Panels are divs, not sections, so a locator for "the section holding this heading" finds that section, not the whole panel. */}
      {TABS.map(
        (t) =>
          opened.has(t.id) && (
            <div
              key={t.id}
              id={`panel-${t.id}`}
              role="tabpanel"
              aria-labelledby={`tab-${t.id}`}
              hidden={tab !== t.id}
              className={styles.tabPanel}
              data-stale={stale}
            >
              {panels[t.id]()}
            </div>
          ),
      )}
    </main>
  );
}
