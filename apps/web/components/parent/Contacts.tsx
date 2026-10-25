"use client";

import type { Brain } from "@kite/client";
import { KID_ID } from "@/lib/brain";
import type { Contact } from "./model";
import styles from "./parent.module.css";
import { useRead } from "./useRead";

export function Contacts({ brain, name }: { brain: Brain; name: string }) {
  const { data, error } = useRead<Contact[]>(brain, `/kids/${KID_ID}/contacts`);
  return (
    <div className={styles.section}>
      <h2>Contacts</h2>
      <p className={styles.lede}>The only people {name}&apos;s phone can call or text from Kite.</p>
      {error && <p className={styles.error}>Contacts didn&apos;t load: {error}. Reload to try again.</p>}
      {data && data.length === 0 && <p className={styles.quiet}>No contacts yet.</p>}
      <ul className={styles.contacts}>
        {data?.map((c) => (
          <li key={c.phone}>
            <span className={styles.avatar} aria-hidden>
              {c.name.charAt(0)}
            </span>
            <strong>{c.name}</strong>
            <a href={`tel:${c.phone}`}>{c.phone}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
