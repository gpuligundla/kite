"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { formatWhen, kindWords, mapUrl, type Alert } from "./model";
import styles from "./parent.module.css";

/** Newest first. Shows the kind and the time only: the brain never sends a parent the kid's words. */
export function Alerts({ alerts, name }: { alerts: Alert[]; name: string }) {
  const reduce = useReducedMotion();
  // The live region stays mounted so the first alert is announced, not just drawn.
  return (
    <div aria-live="polite">
      {alerts.length > 0 && <List alerts={alerts} name={name} reduce={!!reduce} />}
    </div>
  );
}

function List({ alerts, name, reduce }: { alerts: Alert[]; name: string; reduce: boolean }) {
  return (
    <section className={styles.alerts} aria-labelledby="alerts-h">
      <h2 id="alerts-h">Needs your attention</h2>
      <p className={styles.quiet}>You see what happened and when. Kite never shows you {name}&apos;s words.</p>
      <ul>
        <AnimatePresence initial={false}>
          {alerts.map((a) => (
            <motion.li
              key={a.alert_id}
              className={styles.alert}
              initial={{ opacity: 0, transform: reduce ? "none" : "translateY(-8px)" }}
              animate={{ opacity: 1, transform: "translateY(0px)" }}
              transition={{ duration: 0.26, ease: [0.23, 1, 0.32, 1] }}
            >
              <strong className={styles.alertKind}>{kindWords(a.kinds)}</strong>
              <span>
                {a.kinds.includes("sos")
                  ? `${name} pressed SOS on her phone.`
                  : `Kite noticed this in a conversation with ${name} and told you right away.`}
              </span>
              <time dateTime={a.at} className={styles.quiet}>
                {formatWhen(a.at)}
              </time>
              {a.lat != null && a.lng != null && (
                <a href={mapUrl(a.lat, a.lng)} target="_blank" rel="noreferrer" className={styles.mapLink}>
                  See where on a map ({a.lat.toFixed(3)}, {a.lng.toFixed(3)})
                </a>
              )}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </section>
  );
}
