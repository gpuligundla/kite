import Link from "next/link";
import { KiteMark } from "@/components/kit/KiteMark";
import styles from "./home.module.css";

export default function Home() {
  return (
    <main className={`kid ${styles.home}`} data-band="g35">
      <KiteMark size={110} />
      <h1>Kite</h1>
      <p>A learning companion that grows up with your kid.</p>
      <nav className={styles.choices}>
        <Link href="/os">Kid&apos;s screen</Link>
        <Link href="/parent">Grown-up view</Link>
      </nav>
      <p className={styles.hint}>A new browser pairs once with /setup?token=… from the seed.</p>
    </main>
  );
}
