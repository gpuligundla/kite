import type { ButtonHTMLAttributes } from "react";
import styles from "./kit.module.css";

/** `go` is the one main action on a screen; `quiet` is everything else. */
export function Button({ tone = "quiet", className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "go" | "quiet" }) {
  return <button className={`${styles.button} ${styles[tone]} ${className ?? ""}`} {...rest} />;
}

/** A short fact next to something: a reading level, a count, a state. */
export function Badge({ children, tone = "plain" }: { children: React.ReactNode; tone?: "plain" | "good" | "warn" }) {
  return <span className={`${styles.badge} ${styles[`badge_${tone}`]}`}>{children}</span>;
}
