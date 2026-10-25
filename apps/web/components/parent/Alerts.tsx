"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { ALERT_KINDS, ago, formatPlace, formatWhen, kindWords, leadKind, mapUrl, tilesAround, type Alert } from "./model";
import styles from "./parent.module.css";

const SEEN_KEY = "kite.parent.seen-alerts";
const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const enter = (reduce: boolean) => ({
  initial: { opacity: 0, transform: reduce ? "none" : "translateY(-8px)" },
  animate: { opacity: 1, transform: "translateY(0px)" },
  transition: { duration: 0.26, ease: EASE_OUT },
});

// "I've seen this" belongs to this device, so it lives in localStorage; storage can be blocked, so every touch is guarded.
function readSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function writeSeen(seen: Set<string>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch {}
}

/**
 * Newest first. What happened, when and where only: the brain never sends a parent the kid's words.
 * Every alert not yet marked seen stays in full view, so a new one can never hide behind an older one.
 */
export function Alerts({ alerts, name }: { alerts: Alert[]; name: string }) {
  const reduce = !!useReducedMotion();
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => setSeen(readSeen()), []);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);
  useEffect(() => setNow(Date.now()), [alerts]);

  const markSeen = (ids: string[]) =>
    setSeen((s) => {
      const next = new Set([...s, ...ids]);
      writeSeen(next);
      return next;
    });
  const open = alerts.filter((a) => !seen.has(a.alert_id));
  const done = alerts.filter((a) => seen.has(a.alert_id));

  // The live region stays mounted so the first alert is announced, not just drawn.
  return (
    <div aria-live="polite" className={styles.alertZone}>
      {open.length > 0 && (
        <section className={styles.alerts} aria-labelledby="alerts-h">
          <div className={styles.alertsHead}>
            <h2 id="alerts-h">Needs your attention</h2>
            <p className={styles.quiet}>You see what happened, when and where. Kite never shows you {name}&apos;s words.</p>
            {open.length > 1 && (
              <button className={styles.textButton} onClick={() => markSeen(open.map((a) => a.alert_id))}>
                Mark all {open.length} as seen
              </button>
            )}
          </div>
          {/* The newest leads as a full card; the rest share one quieter list. Both stay in view until marked seen.
              The lead swaps without an exit so a new SOS never shows two lead cards at once. */}
          <ul className={styles.alertList}>
            <motion.li key={open[0].alert_id} {...enter(reduce)}>
              <AlertCard alert={open[0]} name={name} now={now} featured onSeen={() => markSeen([open[0].alert_id])} />
            </motion.li>
          </ul>
          {open.length > 1 && (
            <ul className={styles.alertRows}>
              <AnimatePresence initial={false}>
                {open.slice(1).map((a) => (
                  <motion.li key={a.alert_id} layout={reduce ? false : "position"} exit={{ opacity: 0 }} {...enter(reduce)}>
                    <AlertCard alert={a} name={name} now={now} featured={false} onSeen={() => markSeen([a.alert_id])} />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </section>
      )}
      {done.length > 0 && (
        <details className={styles.seenAlerts}>
          <summary>
            {done.length === 1 ? "1 alert" : `${done.length} alerts`} you&apos;ve seen
          </summary>
          <ul>
            {done.map((a) => (
              <li key={a.alert_id}>
                <Glyph kind={leadKind(a.kinds)} />
                <strong>{kindWords(a.kinds)}</strong>
                <time dateTime={a.at}>{formatWhen(a.at)}</time>
                {a.lat != null && a.lng != null && (
                  <a href={mapUrl(a.lat, a.lng)} target="_blank" rel="noreferrer">
                    Open map
                  </a>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function AlertCard({ alert, name, now, featured, onSeen }: { alert: Alert; name: string; now: number; featured: boolean; onSeen: () => void }) {
  const kind = leadKind(alert.kinds);
  const { tone, title, next } = ALERT_KINDS[kind];
  const where = alert.lat != null && alert.lng != null ? { lat: alert.lat, lng: alert.lng } : null;
  return (
    <article className={styles.alert} data-tone={tone} data-featured={featured}>
      <div className={styles.alertBody}>
        <p className={styles.alertMeta}>
          <Glyph kind={kind} pulse={featured && tone === "urgent"} />
          <strong>{kindWords(alert.kinds)}</strong>
          <time dateTime={alert.at}>
            {formatWhen(alert.at)}, {ago(alert.at, now)}
          </time>
        </p>
        <h3 className={styles.alertTitle}>{title(name)}</h3>
        {(featured || kind !== "sos") && <p className={styles.alertNext}>{next}</p>}
        <div className={styles.alertActions}>
          <button className={featured ? styles.primaryButton : styles.secondaryButton} onClick={onSeen}>
            I&apos;ve seen this
          </button>
          {!featured && where && (
            <a href={mapUrl(where.lat, where.lng)} target="_blank" rel="noreferrer" className={styles.textLink}>
              Open map
            </a>
          )}
        </div>
      </div>
      {featured && kind === "sos" && <Where where={where} />}
    </article>
  );
}

/** The tiles come from OpenStreetMap only when asked for, so her location isn't sent anywhere until a grown-up opens it. */
function Where({ where }: { where: { lat: number; lng: number } | null }) {
  const [shown, setShown] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!where) return <div className={styles.where}><p className={styles.quiet}>Her phone didn&apos;t share a location.</p></div>;
  return (
    <div className={styles.where}>
      <div className={styles.mapBox} data-shown={shown && !failed}>
        {shown && !failed && (
          <div className={styles.tiles}>
            {tilesAround(where.lat, where.lng).map((t) => (
              <img key={t.url} src={t.url} alt="" style={{ left: t.left, top: t.top }} onError={() => setFailed(true)} />
            ))}
          </div>
        )}
        <span className={styles.pin} aria-hidden />
        {shown && !failed && <span className={styles.osm}>© OpenStreetMap contributors</span>}
      </div>
      <div className={styles.whereText}>
        <span className={styles.quiet}>Where her phone was</span>
        <strong>{formatPlace(where.lat, where.lng)}</strong>
        {failed && <span className={styles.quiet}>The map didn&apos;t load. Open it in OpenStreetMap instead.</span>}
        <span className={styles.alertActions}>
          {!shown && (
            <button className={styles.secondaryButton} onClick={() => setShown(true)}>
              Show map
            </button>
          )}
          <a href={mapUrl(where.lat, where.lng)} target="_blank" rel="noreferrer" className={styles.textLink}>
            Open in OpenStreetMap
          </a>
        </span>
      </div>
    </div>
  );
}

function Glyph({ kind, pulse = false }: { kind: Alert["kinds"][number]; pulse?: boolean }) {
  return (
    <span className={styles.glyph} data-tone={ALERT_KINDS[kind].tone} data-pulse={pulse} aria-hidden>
      <svg viewBox="0 0 24 24">
        {kind === "sos" ? (
          <path d="M12 2.5 21.5 12 12 21.5 2.5 12Z" />
        ) : (
          <path d="M5 4h14a2.5 2.5 0 0 1 2.5 2.5v8A2.5 2.5 0 0 1 19 17h-7.5L6.5 21v-4H5a2.5 2.5 0 0 1-2.5-2.5v-8A2.5 2.5 0 0 1 5 4Z" />
        )}
      </svg>
    </span>
  );
}
