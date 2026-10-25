"use client";

import type { Brain } from "@kite/client";
import { useState } from "react";
import {
  STATUSES, ago, formatTime, formatWhen, kindWords, mapUrl, nextStatus, statusOf,
  type CaseChange, type CaseStatus, type Report,
} from "./model";
import styles from "./counselor.module.css";

interface Props {
  brain: Brain;
  reports: Report[] | null;
  name: string;
  selected: string | null;
  onSelect: (id: string) => void;
  onChanged: (id: string, history: CaseChange[]) => void;
}

export function Reports({ brain, reports, name, selected, onSelect, onChanged }: Props) {
  if (!reports) return <p className={styles.loading}>Loading reports…</p>;
  if (reports.length === 0)
    return (
      <section className={`glass ${styles.empty}`}>
        <h1>No reports about {name}</h1>
        <p>
          Kite sends a report here, and never to her parents, when something she says may mean someone is hurting her. A new
          one appears on this page the moment it&apos;s sent.
        </p>
      </section>
    );
  const report = reports.find((r) => r.alert_id === selected) ?? reports[0];
  const now = Date.now();
  return (
    <div className={styles.reports}>
      <nav className={styles.list} aria-label="Reports, newest first">
        <h1 className={styles.listTitle}>
          Reports <span className={styles.count}>{reports.length}</span>
        </h1>
        <ol>
          {reports.map((r) => (
            <li key={r.alert_id}>
              <button
                type="button"
                className={styles.item}
                data-tone={statusOf(r.status).tone}
                aria-current={r.alert_id === report.alert_id ? "true" : undefined}
                onClick={() => onSelect(r.alert_id)}
              >
                <span className={styles.itemTop}>
                  <StatusTag status={r.status} />
                  <time dateTime={r.at}>{ago(r.at, now)}</time>
                </span>
                <strong className={styles.itemKind}>{kindWords(r.kinds)}</strong>
                <span className={styles.itemSaid}>{r.said}</span>
                <span className={styles.itemWhen}>{formatWhen(r.at)}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <Detail key={report.alert_id} brain={brain} report={report} name={name} now={now} onChanged={onChanged} />
    </div>
  );
}

export function StatusTag({ status }: { status: CaseStatus }) {
  const s = statusOf(status);
  return (
    <span className={styles.status} data-tone={s.tone}>
      <span className={styles.statusDot} aria-hidden />
      {s.label}
    </span>
  );
}

function Detail({ brain, report, name, now, onChanged }: { brain: Brain; report: Report; name: string; now: number; onChanged: Props["onChanged"] }) {
  return (
    <article className={styles.detail} aria-label={`Report: ${kindWords(report.kinds)}`}>
      <header className={styles.detailHead}>
        <div>
          <h2>{kindWords(report.kinds)}</h2>
          <p className={styles.soft}>
            <time dateTime={report.at}>{formatWhen(report.at)}</time>, {ago(report.at, now)}
          </p>
        </div>
        <StatusTag status={report.status} />
      </header>

      <figure className={`glass-strong ${styles.said}`} data-tone={statusOf(report.status).tone}>
        <blockquote>{report.said}</blockquote>
        <figcaption>
          {name}, to Kite, at {formatTime(report.at)}. Kite sent this to you and not to her parents.
        </figcaption>
      </figure>

      <div className={styles.detailGrid}>
        <CaseEditor brain={brain} report={report} name={name} onChanged={onChanged} />
        <Conversation report={report} name={name} />
        {report.lat != null && report.lng != null && (
          <section className={`glass ${styles.panel}`}>
            <h3>Where she was</h3>
            <p>
              <a href={mapUrl(report.lat, report.lng)} target="_blank" rel="noreferrer">
                {report.lat.toFixed(4)}, {report.lng.toFixed(4)} on a map
              </a>
            </p>
          </section>
        )}
      </div>
    </article>
  );
}

function Conversation({ report, name }: { report: Report; name: string }) {
  return (
    <section className={`glass ${styles.panel} ${styles.conversation}`}>
      <h3>The conversation</h3>
      <p className={styles.soft}>
        {report.context_purged
          ? "Kite deletes every chat after 30 days, and this one is gone. Her words that raised the report are kept with it for a year."
          : report.context.length
            ? `What ${name} and Kite said just before, in the same chat.`
            : "This was the first thing she said in that chat."}
      </p>
      <ol className={styles.transcript}>
        {report.context.map((t, i) => (
          <Line key={i} role={t.role} speaker={t.role === "kid" ? name : "Kite"} text={t.text} />
        ))}
        <li className={styles.line} data-role="flagged">
          <span className={styles.speaker}>
            {name}
            <span className={styles.flag}>Raised this report</span>
          </span>
          <p>{report.said}</p>
        </li>
        <li className={styles.line} data-role="reply">
          <span className={styles.speaker}>
            Kite
            <span className={styles.flagSoft}>Fixed safety reply</span>
          </span>
          <p>{report.reply}</p>
        </li>
      </ol>
    </section>
  );
}

const LONG = 280;

/** Kite's ordinary answers can run long; the counselor reads her side first, and opens Kite's when it matters. */
function Line({ role, speaker, text }: { role: "kid" | "kite"; speaker: string; text: string }) {
  const [open, setOpen] = useState(false);
  const long = role === "kite" && text.length > LONG;
  return (
    <li className={styles.line} data-role={role}>
      <span className={styles.speaker}>{speaker}</span>
      <p className={long && !open ? styles.clamped : undefined}>{text}</p>
      {long && (
        <button type="button" className={styles.more} aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Show less" : "Show Kite's whole answer"}
        </button>
      )}
    </li>
  );
}

function CaseEditor({ brain, report, name, onChanged }: { brain: Brain; report: Report; name: string; onChanged: Props["onChanged"] }) {
  const [pick, setPick] = useState<CaseStatus>(nextStatus(report.status));
  const [note, setNote] = useState("");
  const [state, setState] = useState<{ saving?: boolean; error?: string; saved?: string }>({});
  const moving = pick !== report.status;
  const can = (moving || note.trim().length > 0) && !state.saving;
  const reached = STATUSES.findIndex((s) => s.id === report.status);
  const reachedAt = new Map(report.history.map((c) => [c.status, c.at]));

  async function save() {
    setState({ saving: true });
    try {
      const history = await brain.put<CaseChange[]>(`/counselor/alerts/${report.alert_id}/status`, { status: pick, note: note.trim() || null });
      onChanged(report.alert_id, history);
      setNote("");
      setPick(nextStatus(pick));
      setState({ saved: moving ? `Saved as ${statusOf(pick).label}.` : "Note added." });
    } catch (err) {
      setState({ error: `That didn't save: ${(err as Error).message}. Try again.` });
    }
  }

  return (
    <section className={`glass ${styles.panel} ${styles.case}`}>
      <h3>The case</h3>
      <div className={styles.track} role="radiogroup" aria-label="Case status">
        {STATUSES.map((s, i) => {
          const when = s.id === "new" ? report.at : reachedAt.get(s.id);
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={pick === s.id}
              className={styles.step}
              data-tone={s.tone}
              data-reached={i <= reached || undefined}
              data-current={s.id === report.status || undefined}
              onClick={() => setPick(s.id)}
            >
              <span className={styles.stepMark} aria-hidden />
              <span>{s.label}</span>
              {when && i <= reached && <time dateTime={when}>{formatWhen(when)}</time>}
            </button>
          );
        })}
      </div>
      <p className={styles.soft}>{moving ? statusOf(pick).detail : `Still ${statusOf(report.status).label.toLowerCase()}. Add a note to the case.`}</p>
      <label className={styles.noteLabel} htmlFor={`note-${report.alert_id}`}>
        Note for the case {moving ? "(optional)" : ""}
      </label>
      <textarea
        id={`note-${report.alert_id}`}
        className={styles.note}
        rows={3}
        maxLength={2000}
        value={note}
        placeholder="What happened, in plain words. Sealed; only this console can read it."
        onChange={(e) => setNote(e.target.value)}
      />
      <div className={styles.actions}>
        <button type="button" className={styles.primary} data-tone={statusOf(pick).tone} disabled={!can} onClick={save}>
          {state.saving ? "Saving…" : moving ? statusOf(pick).action : "Add note"}
        </button>
        <span className={styles.soft} role="status">
          {state.error ?? state.saved ?? ""}
        </span>
      </div>

      <h4 className={styles.historyTitle}>History</h4>
      {report.history.length === 0 ? (
        <p className={styles.soft}>Nothing yet. {name}&apos;s report is waiting for you.</p>
      ) : (
        <ol className={styles.history}>
          {[...report.history].reverse().map((c, i, all) => {
            const prev = all[i + 1]?.status ?? "new";
            return (
              <li key={c.at + i} data-tone={statusOf(c.status).tone}>
                <span className={styles.historyHead}>
                  <strong>{c.status === prev ? "Note" : statusOf(c.status).label}</strong>
                  <time dateTime={c.at}>{formatWhen(c.at)}</time>
                </span>
                {c.note && <p>{c.note}</p>}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
