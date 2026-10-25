"use client";

import { useState } from "react";
import { Glyph } from "@/components/os/Glyph";
import type { Contact } from "./classroom";
import s from "./shell.module.css";

// ponytail: the phone apps are the launcher's shape only. Nothing dials, sends or shares; a real handheld wires these
// to the carrier and to the family's location service, behind the same approved-contacts list.
const DEMO_NOTE = "This demo doesn't place calls or send messages.";
const QUICK = ["I'm on my way", "Can you pick me up?", "I'm at school", "Love you!"];

function Face({ name, big }: { name: string; big?: boolean }) {
  return (
    <span className={s.face} data-big={big === true} aria-hidden="true">
      {name.slice(0, 1)}
    </span>
  );
}

/** Calls: only the people her grown-ups approved, and 911. */
export function CallApp({ people, calling, onCall, onHangUp }: {
  people: Contact[];
  calling?: string;
  onCall: (id: string) => void;
  onHangUp: () => void;
}) {
  const who = calling === "911" ? { id: "911", name: "911 Emergency" } : people.find((p) => p.id === calling);
  if (who) {
    return (
      <div className={s.calling}>
        <Face name={who.name} big />
        <h2>{who.name}</h2>
        <p className={s.callingState}>Calling…</p>
        <button type="button" className={s.hangUp} onClick={onHangUp} aria-label="End call">
          <Glyph name="call" size={30} />
        </button>
        <p className={s.demoNote}>{DEMO_NOTE}</p>
      </div>
    );
  }
  return (
    <div className={s.list}>
      <p className={s.quietLine}>You can call the people your grown-ups approved.</p>
      <ul className={s.contacts}>
        {people.map((p) => (
          <li key={p.id}>
            <Face name={p.name} />
            <span className={s.rowText}>
              <strong>{p.name}</strong>
              <span>Approved by your grown-ups</span>
            </span>
            <button type="button" className={s.callButton} onClick={() => onCall(p.id)} aria-label={`Call ${p.name}`}>
              <Glyph name="call" size={22} />
            </button>
          </li>
        ))}
        <li data-tone="sos">
          <span className={s.face} data-tone="sos" aria-hidden="true">!</span>
          <span className={s.rowText}>
            <strong>911</strong>
            <span>Emergencies only</span>
          </span>
          <button type="button" className={s.callButton} data-tone="sos" onClick={() => onCall("911")} aria-label="Call 911">
            <Glyph name="call" size={22} />
          </button>
        </li>
      </ul>
      <p className={s.demoNote}>{DEMO_NOTE}</p>
    </div>
  );
}

/** Texts: approved people only, with quick replies a kid can send with one tap. */
export function MessagesApp({ people, with: withId, onOpen }: { people: Contact[]; with?: string; onOpen: (id: string) => void }) {
  const [sent, setSent] = useState<Record<string, string[]>>({});
  const [draft, setDraft] = useState("");
  const who = people.find((p) => p.id === withId);
  if (!who) {
    return (
      <div className={s.list}>
        <ul className={s.contacts}>
          {people.map((p) => (
            <li key={p.id}>
              <button type="button" className={s.thread} onClick={() => onOpen(p.id)}>
                <Face name={p.name} />
                <span className={s.rowText}>
                  <strong>{p.name}</strong>
                  <span>{sent[p.id]?.at(-1) ?? "Say hi"}</span>
                </span>
                <Glyph name="chevron" size={20} />
              </button>
            </li>
          ))}
        </ul>
        <p className={s.demoNote}>Only the people your grown-ups approved can text you. {DEMO_NOTE}</p>
      </div>
    );
  }
  const send = (text: string) => {
    if (!text.trim()) return;
    setSent((m) => ({ ...m, [who.id]: [...(m[who.id] ?? []), text.trim()] }));
    setDraft("");
  };
  return (
    <div className={s.chat}>
      <p className={s.chatWith}>
        <Face name={who.name} />
        {who.name}
      </p>
      <ol className={s.bubbles}>
        {(sent[who.id] ?? []).map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ol>
      <div className={s.quick}>
        {QUICK.map((q) => (
          <button key={q} type="button" onClick={() => send(q)}>
            {q}
          </button>
        ))}
      </div>
      <form
        className={s.compose}
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Text ${who.name.split(" ")[0]}`} aria-label={`Text ${who.name}`} />
        <button type="submit" disabled={!draft.trim()}>
          Send
        </button>
      </form>
      <p className={s.demoNote}>{DEMO_NOTE}</p>
    </div>
  );
}

/** Where she is, who can see it, and field-trip mode. */
export function LocationApp({ people, fieldTrip, onFieldTrip }: { people: Contact[]; fieldTrip: boolean; onFieldTrip: (on: boolean) => void }) {
  const names = people.map((p) => p.name.split(" ")[0]).join(" and ") || "Your grown-ups";
  return (
    <div className={s.list}>
      <div className={s.map} aria-label="A map with your location">
        <svg viewBox="0 0 360 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <path d="M-10 60 L380 30 M-10 150 L380 120 M70 -10 L110 210 M230 -10 L250 210 M-10 100 Q180 80 380 90" />
          <rect x="130" y="70" width="70" height="40" rx="8" className={s.mapSchool} />
        </svg>
        <span className={s.mapPin}>
          <Glyph name="pin" size={30} />
        </span>
        <span className={s.mapLabel}>Lincoln Elementary</span>
      </div>
      <div className={s.setting}>
        <Glyph name="people" size={22} />
        <span className={s.rowText}>
          <strong>Shared with {names}</strong>
          <span>Your grown-ups turned this on. It stays on.</span>
        </span>
        <Glyph name="lock" size={18} />
      </div>
      <button type="button" role="switch" aria-checked={fieldTrip} className={s.setting} data-on={fieldTrip} onClick={() => onFieldTrip(!fieldTrip)}>
        <Glyph name="bus" size={22} />
        <span className={s.rowText}>
          <strong>Field trip mode</strong>
          <span>{fieldTrip ? "On. Stay with your group. Your teacher and grown-ups can find you." : "Turn on when your class goes somewhere new."}</span>
        </span>
        <span className={s.switch} aria-hidden="true">
          <i />
        </span>
      </button>
      <p className={s.demoNote}>This demo shows a sample map and doesn&apos;t share a real location.</p>
    </div>
  );
}
