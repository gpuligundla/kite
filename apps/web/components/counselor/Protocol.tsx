import { HOTLINES, type Report } from "./model";
import styles from "./counselor.module.css";

/** What to do next with an abuse report. General guidance for a US mandated reporter; the district's policy wins. */
export function Protocol({ name, reports }: { name: string; reports: Report[] | null }) {
  const reply = reports?.[0]?.reply;
  const steps = [
    { title: "Read the report today", body: `Kite sends these to you alone. ${name}'s parents get nothing about it.` },
    {
      title: `Talk with ${name} privately`,
      body: "Listen and stay calm. Let her tell it in her own words, without leading questions. Don't promise to keep it secret; tell her who you'll need to tell and why.",
    },
    {
      title: "Report it to child protective services",
      body: "As a mandated reporter you need reasonable suspicion, not proof. Report right away, within the time your state sets. Childhelp can connect you to the local agency.",
    },
    {
      title: "Follow your district's policy",
      body: "Tell your principal or designated safeguarding lead, as your district requires. Write down what she said in her own words; case notes here are sealed.",
    },
    { title: "Keep checking in", body: "Meet with her again after the report. Close the case here once it's handed off and she has a plan." },
  ];
  return (
    <div className={styles.protocol}>
      <section className={`glass-strong ${styles.warning}`}>
        <h1>Don&apos;t contact her parents first</h1>
        <p>
          In an abuse report, the person hurting her may live with her. Calling home can put her in more danger and give
          someone time to pressure her. Child protective services decides when and how her family is told.
        </p>
      </section>

      <section className={`glass ${styles.panel} ${styles.steps}`}>
        <h2>What to do next</h2>
        <ol>
          {steps.map((s) => (
            <li key={s.title}>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <div className={styles.side}>
        <section className={`glass ${styles.panel} ${styles.hotlines}`}>
          <h2>Who to call</h2>
          <ul>
            {HOTLINES.map((h) => (
              <li key={h.number}>
                <a href={`tel:${h.tel}`} className={styles.number}>
                  {h.number}
                </a>
                <strong>{h.name}</strong>
                <p className={styles.soft}>{h.detail}</p>
              </li>
            ))}
          </ul>
        </section>
  
        {reply && (
          <section className={`glass ${styles.panel} ${styles.told}`}>
            <h2>What Kite already told her</h2>
            <blockquote>{reply}</blockquote>
            <p className={styles.soft}>
              A fixed reply, the same every time, written by people. Kite doesn&apos;t improvise when a child may be in
              danger, and it keeps none of this in its memory of her.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
