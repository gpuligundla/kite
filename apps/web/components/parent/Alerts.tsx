"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { ALERT_KINDS, KID, ago, formatPlace, formatWhen, kindWords, leadKind, mapUrl, tilesAround, type Alert } from "./model";
import styles from "./parent.module.css";

const SEEN_KEY = "kite.parent.seen-alerts";
const EASE_OUT = [0.23, 1, 0.32, 1] as const;

/** "I've seen this" belongs to this device, so it lives in localStorage; storage can be blocked, so every touch is guarded. */
export function useSeen() {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    try {
      setIds(new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]") as string[]));
    } catch {}
  }, []);
  const mark = (list: string[]) =>
    setIds((s) => {
      const next = new Set([...s, ...list]);
      try {
        localStorage.setItem(SEEN_KEY, JSON.stringify([...next]));
      } catch {}
      return next;
    });
  return { has: (id: string) => ids.has(id), mark };
}
export type Seen = ReturnType<typeof useSeen>;

/** A clock for "4 minutes ago" that moves on its own and whenever the alerts change. */
function useNow(alerts: Alert[]) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);
  useEffect(() => setNow(Date.now()), [alerts.length]);
  return now;
}

/**
 * Under the app bar on every tab: the newest alert this device hasn't marked seen, in full, and how many more wait.
 * What happened, when and where only: the brain never sends a parent the kid's words.
 */
export function AlertBar({ alerts, seen, onOpen }: { alerts: Alert[]; seen: Seen; onOpen: () => void }) {
  const reduce = useReducedMotion();
  const now = useNow(alerts);
  const open = alerts.filter((a) => !seen.has(a.alert_id));
  const lead = open[0];
  const kind = lead && leadKind(lead.kinds);
  // The live region stays mounted so a first alert is announced, not just drawn.
  return (
    <div aria-live="polite" className={styles.alertSlot}>
      <AnimatePresence initial={false} mode="popLayout">
        {lead && (
          <motion.section
            key={lead.alert_id}
            className={styles.alertBar}
            data-tone={ALERT_KINDS[kind].tone}
            data-latest-alert={lead.alert_id}
            aria-labelledby="alert-h"
            initial={{ opacity: 0, transform: reduce ? "none" : "translateY(-8px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)" }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.26, ease: EASE_OUT }}
          >
            <Glyph kind={kind} pulse={ALERT_KINDS[kind].tone === "urgent"} />
            <div className={styles.alertText}>
              <p className={styles.alertMeta}>
                <strong>{kindWords(lead.kinds)}</strong>
                <time dateTime={lead.at}>
                  {formatWhen(lead.at)}, {ago(lead.at, now)}
                </time>
              </p>
              <h2 id="alert-h">{ALERT_KINDS[kind].title(KID.name)}</h2>
              <p className={styles.alertNext}>{ALERT_KINDS[kind].next}</p>
              {open.length > 1 && (
                <p className={styles.alertMore}>
                  {open.length - 1 === 1 ? "One earlier alert" : `${open.length - 1} earlier alerts`} not marked seen,
                  since {formatWhen(open.at(-1)!.at)}.
                </p>
              )}
            </div>
            <div className={styles.alertActions}>
              <button className={styles.primaryButton} onClick={() => seen.mark([lead.alert_id])}>
                I&apos;ve seen this
              </button>
              <button className={styles.ghostButton} onClick={onOpen}>
                {lead.lat != null ? "Where she was" : "All alerts"}
              </button>
              {open.length > 1 && (
                <button className={styles.linkButton} onClick={() => seen.mark(open.map((a) => a.alert_id))}>
                  Mark all {open.length} seen
                </button>
              )}
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}

/** The tiles come from OpenStreetMap only when asked for, so her location isn't sent anywhere until a grown-up opens it. */
export function WhereMap({ where }: { where: { lat: number; lng: number } | null }) {
  const [shown, setShown] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!where)
    return (
      <div className={styles.mapBox}>
        <div className={styles.mapArea}>
          <p className={styles.mapNote}>Her phone didn&apos;t share a location.</p>
        </div>
      </div>
    );
  return (
    <div className={styles.mapBox}>
      <div className={styles.mapArea}>
        {shown && !failed && (
          <div className={styles.tiles}>
            {tilesAround(where.lat, where.lng).map((t) => (
              <img key={t.url} src={t.url} alt="" style={{ left: t.left, top: t.top }} onError={() => setFailed(true)} />
            ))}
          </div>
        )}
        <span className={styles.pin} aria-hidden />
      </div>
      <div className={styles.mapCaption}>
        <strong>{formatPlace(where.lat, where.lng)}</strong>
        {failed && <span>The map didn&apos;t load. Open it in OpenStreetMap instead.</span>}
        <span className={styles.mapActions}>
          {!shown && (
            <button className={styles.ghostButton} onClick={() => setShown(true)}>
              Show map
            </button>
          )}
          <a href={mapUrl(where.lat, where.lng)} target="_blank" rel="noreferrer" className={styles.linkButton}>
            Open in OpenStreetMap
          </a>
        </span>
        {shown && !failed && <span className={styles.osm}>© OpenStreetMap contributors</span>}
      </div>
    </div>
  );
}

export function Glyph({ kind, pulse = false }: { kind: Alert["kinds"][number]; pulse?: boolean }) {
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
