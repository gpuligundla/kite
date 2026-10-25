"use client";

import type { Brain } from "@kite/client";
import { useEffect, useMemo, useState } from "react";
import { formatTime, formatWhen, logRows, type Receipt, type Report } from "./model";
import styles from "./counselor.module.css";

/** The counselor's own reads and changes, newest first. Reading the log itself writes nothing. */
export function AccessLog({ brain, reports, name }: { brain: Brain; reports: Report[] | null; name: string }) {
  const [state, setState] = useState<{ receipts?: Receipt[]; error?: string }>({});
  useEffect(() => {
    let current = true;
    brain.get<Receipt[]>("/counselor/receipts").then(
      (receipts) => current && setState({ receipts }),
      (err: Error) => current && setState({ error: `The access log didn't load: ${err.message}. Reload to try again.` }),
    );
    return () => {
      current = false;
    };
  }, [brain]);
  const byId = useMemo(() => new Map((reports ?? []).map((r) => [r.alert_id, r])), [reports]);

  if (state.error) return <p className={styles.error}>{state.error}</p>;
  if (!state.receipts) return <p className={styles.loading}>Loading the access log…</p>;
  const receipts = state.receipts;
  const changes = receipts.filter((r) => r.what.startsWith("case ")).length;
  return (
    <div className={styles.access}>
      <section className={`glass-strong ${styles.hero} ${styles.accessHero}`}>
        <p className={styles.bigNumber}>{receipts.length}</p>
        <div>
          <h1>Every look is written down</h1>
          <p>
            Each time this console opens one of {name}&apos;s reports or changes a case, Kite records what and when. That&apos;s{" "}
            {receipts.length - changes} reads and {changes} case changes so far
            {receipts[0] ? `, the latest ${formatWhen(receipts[0].at)}` : ""}.
          </p>
          <p className={styles.soft}>Her family&apos;s reads of her learning aren&apos;t part of this log, and nothing in it reaches them.</p>
        </div>
      </section>

      <section className={`glass ${styles.panel}`}>
        <h2>Access log</h2>
        {receipts.length === 0 ? (
          <p className={styles.soft}>Nothing yet. Opening a report adds the first line here.</p>
        ) : (
          logRows(receipts, byId, name).map((g) => (
            <div key={g.day} className={styles.logDay}>
              <h3>{g.day}</h3>
              <ol>
                {g.rows.map((r, i) => (
                  <li key={r.at + i} data-change={r.change || undefined}>
                    <time dateTime={r.at}>{formatTime(r.at)}</time>
                    <span>{r.words}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
