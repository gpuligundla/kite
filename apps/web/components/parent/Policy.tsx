"use client";

import type { Brain } from "@kite/client";
import { useState } from "react";
import { POLICY_ACTIONS, POLICY_TOPICS, type PolicyAction } from "./model";
import styles from "./parent.module.css";

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
    <div className={styles.section}>
      <h2>Sensitive topics</h2>
      <p className={styles.lede}>
        Choose what Kite does when {name} asks about each of these. A change counts from her next question.
      </p>
      <dl className={styles.actionKey}>
        {POLICY_ACTIONS.map((a) => (
          <div key={a.action}>
            <dt>{a.label}</dt>
            <dd>{a.detail}</dd>
          </div>
        ))}
      </dl>
      <ul className={styles.policyList}>
        {POLICY_TOPICS.map(({ topic, name: label }) => {
          const s = status[topic];
          return (
            <li key={topic} className={styles.policyRow}>
              <fieldset>
                <legend>{label}</legend>
                <div className={styles.segmented}>
                  {POLICY_ACTIONS.map((a) => (
                    <label key={a.action}>
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
              <span className={styles.saveState} role="status" data-state={s?.state}>
                {s?.state === "saving" && "Saving…"}
                {s?.state === "saved" && "Saved"}
                {s?.state === "failed" && s.message}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
