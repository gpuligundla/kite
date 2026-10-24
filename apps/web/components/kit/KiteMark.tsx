import styles from "./KiteMark.module.css";

/** Kite itself: a four-panel diamond kite. Its tail waves while Kite is speaking. */
export function KiteMark({ size = 96, speaking = false, label = "Kite" }: { size?: number; speaking?: boolean; label?: string }) {
  return (
    <svg className={styles.kite} data-speaking={speaking} width={size} height={size * 1.6} viewBox="0 0 100 160" role="img" aria-label={label}>
      <g className={styles.body}>
        <path d="M50 4 L50 70 L12 44 Z" fill="var(--kite-red)" />
        <path d="M50 4 L88 44 L50 70 Z" fill="var(--kite-yellow)" />
        <path d="M12 44 L50 70 L50 100 Z" fill="var(--tail-teal)" />
        <path d="M88 44 L50 100 L50 70 Z" fill="var(--sky-deep)" />
        <path d="M50 4 L50 100 M12 44 L88 44" stroke="var(--ink)" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="40" cy="50" r="3.2" fill="var(--ink)" />
        <circle cx="60" cy="50" r="3.2" fill="var(--ink)" />
        <path d="M43 59 Q50 64 57 59" stroke="var(--ink)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      </g>
      <g className={styles.tail}>
        <path d="M50 100 C40 112 60 122 50 134 C40 146 56 152 50 158" stroke="var(--ink)" strokeWidth="2" fill="none" />
        <path d="M44 114 L56 120 L44 120 L56 114 Z" fill="var(--kite-red)" />
        <path d="M44 138 L56 144 L44 144 L56 138 Z" fill="var(--kite-yellow)" />
      </g>
    </svg>
  );
}
