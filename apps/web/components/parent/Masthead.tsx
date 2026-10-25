import { KiteMark } from "@/components/kit/KiteMark";
import styles from "./parent.module.css";

export function Masthead({ who = "Grown-up view" }: { who?: string }) {
  return (
    <div className={styles.masthead}>
      <KiteMark size={22} label="" />
      <span className={styles.brand}>Kite</span>
      <span className={styles.role}>{who}</span>
    </div>
  );
}
