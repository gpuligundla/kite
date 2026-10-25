"use client";

import type { Brain } from "@kite/client";
import { KID_ID } from "@/lib/brain";
import { Glyph, WhereMap, type Seen } from "./Alerts";
import { ALERT_KINDS, KID, formatPlace, formatWhen, kindWords, leadKind, mapUrl, type Alert, type Contact } from "./model";
import ui from "./parent.module.css";
import t from "./tabs.module.css";
import { useRead } from "./useRead";

const dayFmt = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

/** Alerts newest first, where her phone was, and who her phone can reach. Never her words. */
export function Safety({ brain, alerts, seen }: { brain: Brain; alerts: Alert[]; seen: Seen }) {
  const sos = alerts.find((a) => a.kinds.includes("sos"));
  const lead = sos ?? alerts[0];
  const days = [...new Set(alerts.map((a) => dayFmt.format(new Date(a.at))))].map((d) => ({
    day: d,
    alerts: alerts.filter((a) => dayFmt.format(new Date(a.at)) === d),
  }));

  return (
    <div className={t.safety}>
      <section className={`${ui.hero} ${t.sHero}`} data-tone={lead ? ALERT_KINDS[leadKind(lead.kinds)].tone : "calm"} aria-labelledby="sos-h">
        {lead ? (
          <>
            <div className={t.sosText}>
              <p className={t.sosMeta}>
                <Glyph kind={leadKind(lead.kinds)} />
                <strong>{sos ? "Latest SOS" : `Latest alert: ${kindWords(lead.kinds)}`}</strong>
                <time dateTime={lead.at}>{formatWhen(lead.at)}</time>
              </p>
              <h2 id="sos-h" className={t.heroTitle}>
                {ALERT_KINDS[leadKind(lead.kinds)].title(KID.name)}
              </h2>
              <p className={t.sosNext}>{ALERT_KINDS[leadKind(lead.kinds)].next}</p>
              {!seen.has(lead.alert_id) && (
                <button className={ui.primaryButton} onClick={() => seen.mark([lead.alert_id])}>
                  I&apos;ve seen this
                </button>
              )}
            </div>
            <WhereMap where={lead.lat != null && lead.lng != null ? { lat: lead.lat, lng: lead.lng } : null} />
          </>
        ) : (
          <div className={t.sosText}>
            <h2 id="sos-h" className={t.heroTitle}>
              Nothing needs you
            </h2>
            <p className={ui.lede}>
              If {KID.name} presses SOS or tells Kite something worrying, it shows here and at the top of every tab within
              seconds, with where her phone was.
            </p>
          </div>
        )}
      </section>

      <section className={`${ui.panel} ${t.history}`} aria-labelledby="history-h">
        <h2 id="history-h">Every alert</h2>
        <p className={ui.lede}>
          {alerts.length === 0
            ? "None yet."
            : `${alerts.length} ${alerts.length === 1 ? "alert" : "alerts"}, newest first. You see what happened, when and where. Kite never shows you ${KID.name}'s words.`}
        </p>
        {days.map(({ day, alerts: list }) => (
          <div key={day} className={t.day}>
            <h3>
              {day} <span>{list.length}</span>
            </h3>
            <ul>
              {list.map((a) => (
                <li key={a.alert_id} data-seen={seen.has(a.alert_id)}>
                  <Glyph kind={leadKind(a.kinds)} />
                  <strong>{kindWords(a.kinds)}</strong>
                  <time dateTime={a.at}>{timeFmt.format(new Date(a.at))}</time>
                  {a.lat != null && a.lng != null ? (
                    <a href={mapUrl(a.lat, a.lng)} target="_blank" rel="noreferrer">
                      {formatPlace(a.lat, a.lng)}
                    </a>
                  ) : (
                    <span className={ui.quiet}>No location</span>
                  )}
                  <span className={t.seenTag}>{seen.has(a.alert_id) ? "Seen" : "New"}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <Contacts brain={brain} />

      <section className={`${ui.panel} ${t.routing}`} aria-labelledby="routing-h">
        <h2 id="routing-h">Who hears about what</h2>
        <ul>
          <li data-to="you">
            <strong>You</strong>
            <span>SOS from her phone, bullying, a stranger, and anything that sounds like she may hurt herself.</span>
          </li>
          <li data-to="counselor">
            <strong>Her school counselor</strong>
            <span>Anything that may mean someone is hurting her. A trained adult at her school reads it and follows up. It never shows on this page.</span>
          </li>
        </ul>
      </section>
    </div>
  );
}

function Contacts({ brain }: { brain: Brain }) {
  const { data, error } = useRead<Contact[]>(brain, `/kids/${KID_ID}/contacts`);
  return (
    <section className={`${ui.panel} ${t.contacts}`} aria-labelledby="contacts-h">
      <h2 id="contacts-h">Who her phone can call</h2>
      <p className={ui.lede}>The only people {KID.name}&apos;s phone can call or text from Kite.</p>
      {error && <p className={ui.error}>Contacts didn&apos;t load: {error}. Reload to try again.</p>}
      {data?.length === 0 && <p className={ui.empty}>No contacts yet. The people you approve appear here.</p>}
      <ul>
        {data?.map((c) => (
          <li key={c.phone}>
            <span className={t.avatar} aria-hidden>
              {c.name.charAt(0)}
            </span>
            <strong>{c.name}</strong>
            <a href={`tel:${c.phone}`}>{c.phone}</a>
          </li>
        ))}
      </ul>
    </section>
  );
}
