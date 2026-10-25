import { StatusTag } from "./Reports";
import { STATUSES, ago, countByStatus, formatShortDay, formatWhen, kindWords, pace, statusOf, type Report, type Student } from "./model";
import styles from "./counselor.module.css";

interface Props {
  student: Student | null;
  reports: Report[] | null;
  onOpen: (id: string) => void;
}

/** Who she is and her safety picture. Never her learning: that stays with her family. */
export function StudentProfile({ student, reports, onOpen }: Props) {
  if (!student || !reports) return <p className={styles.loading}>Loading her profile…</p>;
  const now = Date.now();
  const counts = countByStatus(reports);
  const open = reports.length - counts.closed;
  return (
    <div className={styles.student}>
      <section className={`glass-strong ${styles.hero}`}>
        <h1 className={styles.heroName}>{student.name}</h1>
        <dl className={styles.facts}>
          <div>
            <dt>Grade</dt>
            <dd>{student.grade}</dd>
          </div>
          <div>
            <dt>Started school</dt>
            <dd>{student.school_start_year}</dd>
          </div>
          <div>
            <dt>Kite last heard from her</dt>
            <dd>
              {student.last_heard ? (
                <>
                  <time dateTime={student.last_heard}>{formatWhen(student.last_heard)}</time>
                  <span className={styles.soft}> {ago(student.last_heard, now)}</span>
                </>
              ) : (
                "Not yet"
              )}
            </dd>
          </div>
        </dl>
        <p className={styles.heroLine}>
          {reports.length === 0
            ? "Kite has never sent you a report about her."
            : `${reports.length === 1 ? "One report" : `${reports.length} reports`} sent to you, ${open === 0 ? "all closed" : `${open} still open`}.`}
        </p>
      </section>

      <section className={`glass ${styles.pipeline}`} aria-label="Reports by case status">
        {STATUSES.map((s) => (
          <div key={s.id} className={styles.stage} data-tone={s.tone} data-empty={counts[s.id] === 0 || undefined}>
            <span className={styles.stageCount}>{counts[s.id]}</span>
            <span className={styles.stageLabel}>
              <span className={styles.statusDot} aria-hidden />
              {s.label}
            </span>
          </div>
        ))}
      </section>

      <section className={`glass ${styles.panel} ${styles.timelinePanel}`}>
        <h2>Her reports over time</h2>
        {reports.length === 0 ? (
          <p className={styles.soft}>When Kite sends a report, it appears here with every step of its case.</p>
        ) : (
          <ol className={styles.timeline}>
            {reports.map((r) => (
              <li key={r.alert_id} data-tone={statusOf(r.status).tone}>
                <div className={styles.tlHead}>
                  <time dateTime={r.at} className={styles.tlDate}>
                    {formatShortDay(r.at)}
                  </time>
                  <strong>{kindWords(r.kinds)}</strong>
                  <StatusTag status={r.status} />
                </div>
                <p className={styles.tlSaid}>{r.said}</p>
                {r.history.length > 0 && (
                  <ol className={styles.tlSteps}>
                    {r.history.map((c, i) => (
                      <li key={c.at + i}>
                        <time dateTime={c.at}>{formatWhen(c.at)}</time> {statusOf(c.status).label}
                      </li>
                    ))}
                  </ol>
                )}
                <button type="button" className={styles.link} onClick={() => onOpen(r.alert_id)}>
                  Open this report
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className={styles.side}>
        {reports.length > 0 && (
          <section className={`glass ${styles.panel}`}>
            <h2>How fast each case moved</h2>
            <ul className={styles.pace}>
              {reports.map((r) => (
                <li key={r.alert_id}>
                  <h3>{formatShortDay(r.at)} report</h3>
                  {r.status === "new" ? (
                    <p className={styles.paceRow} data-tone="urgent">
                      <span className={styles.paceTime}>{ago(r.at, now).replace(" ago", "")}</span>
                      <span>waiting for a first look</span>
                    </p>
                  ) : (
                    pace(r).map((step) => (
                      <p key={step.status} className={styles.paceRow} data-tone={statusOf(step.status).tone}>
                        <span className={styles.paceTime}>{step.after}</span>
                        <span>to {statusOf(step.status).label.toLowerCase()}</span>
                      </p>
                    ))
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        <aside className={`glass ${styles.panel} ${styles.leftOut}`}>
          <h2>What this console leaves out</h2>
          <p>
            Her schoolwork, what she&apos;s learning and her everyday chats with Kite stay with her family. Bullying and
            stranger worries go to her parents. Kite sends you only what may mean someone is hurting her, and the few
            messages around it.
          </p>
        </aside>
      </div>
    </div>
  );
}
