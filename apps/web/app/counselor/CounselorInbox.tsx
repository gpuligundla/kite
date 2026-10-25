"use client";

import { useEffect, useState } from "react";
import { useBrain, useBrainEvents } from "@/lib/brain";
import { Masthead } from "@/components/parent/Masthead";
import { KID, formatWhen, kindWords, type CounselorAlert } from "@/components/parent/model";
import styles from "@/components/parent/parent.module.css";

/** Every read records a receipt per excerpt returned, so the inbox reads once and again only for a new report. */
export function CounselorInbox() {
  const brain = useBrain("counselor");
  const [state, setState] = useState<{ alerts?: CounselorAlert[]; error?: string }>({});
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let current = true;
    brain.get<CounselorAlert[]>("/counselor/alerts").then(
      (alerts) => current && setState({ alerts }),
      (err: Error) => current && setState({ error: err.message }),
    );
    return () => {
      current = false;
    };
  }, [brain, reload]);

  useBrainEvents(brain, (e) => {
    if (e.type === "alert" && state.alerts && !state.alerts.some((a) => a.alert_id === e.alert_id)) setReload((n) => n + 1);
  });

  return (
    <main className={`grown ${styles.page}`}>
      <Masthead who="Counselor inbox" />
      <div className={styles.frame}>
        <header className={styles.inboxHead}>
          <h1>Reports about {KID.name}</h1>
          <p className={styles.lede}>
            Kite sends a report here, and not to her parents, when something she says may mean someone is hurting her.
          </p>
          <p className={styles.notice}>
            Opening this inbox is recorded. Kite logs each report shown here and when it was viewed.
          </p>
        </header>
        {state.error && <p className={styles.error}>The inbox didn&apos;t load: {state.error}. Reload to try again.</p>}
        {state.alerts?.length === 0 && <p className={styles.empty}>No reports.</p>}
        <ol className={styles.inbox}>
          {state.alerts?.map((a) => (
            <li key={a.alert_id} className={styles.report}>
              <div className={styles.reportHead}>
                <strong>{kindWords(a.kinds)}</strong>
                <time dateTime={a.at}>{formatWhen(a.at)}</time>
              </div>
              <blockquote>{a.excerpt}</blockquote>
            </li>
          ))}
        </ol>
      </div>
    </main>
  );
}
