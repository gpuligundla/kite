"use client";

import type { Brain } from "@kite/client";
import { useState } from "react";
import { POLICY_ACTIONS, POLICY_TOPICS, type PolicyAction } from "./model";
import ui from "./parent.module.css";
import t from "./tabs.module.css";

type Status = { state: "saving" } | { state: "saved" } | { state: "failed"; message: string };

/** Each choice saves at once and takes effect on her next question. */
export function Policy({
  brain, family, name, policy, onChange,
}: {
  brain: Brain;
  family: string;
  name: string;
  policy: Record<string, PolicyAction>;
  onChange: (set: (p: Record<string, PolicyAction>) => Record<string, PolicyAction>) => void;
}) {
  const [status, setStatus] = useState<Record<string, Status>>({});

  const choose = async (topic: string, action: PolicyAction) => {
    const before = policy[topic];
    onChange((p) => ({ ...p, [topic]: action }));
    setStatus((s) => ({ ...s, [topic]: { state: "saving" } }));
    try {
      await brain.put(`/families/${family}/policy/${topic}`, { action });
      setStatus((s) => ({ ...s, [topic]: { state: "saved" } }));
    } catch (err) {
      onChange((p) => ({ ...p, [topic]: before }));
      const message = `Not saved: ${(err as Error).message}. Your earlier choice is back; try again.`;
      setStatus((s) => ({ ...s, [topic]: { state: "failed", message } }));
    }
  };

  return (
    <section className={`${ui.panel} ${t.policy}`} aria-labelledby="policy-h">
      <h2 id="policy-h">When she asks about</h2>
      <p className={ui.lede}>Choose what Kite does for each topic. A change counts from {name}&apos;s next question.</p>
      <ul className={t.policyList}>
        {POLICY_TOPICS.map(({ topic, name: label }) => {
          const s = status[topic];
          return (
            <li key={topic}>
              <fieldset>
                <legend>{label}</legend>
                <div className={t.segmented}>
                  {POLICY_ACTIONS.map((a) => (
                    <label key={a.action} title={a.detail}>
                      <input
                        type="radio"
                        name={`policy-${topic}`}
                        value={a.action}
                        checked={policy[topic] === a.action}
                        onChange={() => choose(topic, a.action)}
                      />
                      <span>{a.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <span className={t.saveState} role="status" data-state={s?.state}>
                {s?.state === "saving" && "Saving…"}
                {s?.state === "saved" && "Saved"}
                {s?.state === "failed" && s.message}
              </span>
            </li>
          );
        })}
      </ul>
      <dl className={t.actionKey}>
        {POLICY_ACTIONS.map((a) => (
          <div key={a.action}>
            <dt>{a.label}</dt>
            <dd>{a.detail}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
