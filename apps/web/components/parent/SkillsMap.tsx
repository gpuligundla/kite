import { LEVELS, LEVEL_WORDS, skillsByTopic, type DashboardView, type Level } from "./model";
import styles from "./parent.module.css";

/** Levels are for grown-ups only; the kid side never shows them. */
export function SkillsMap({ view }: { view: DashboardView }) {
  const topics = skillsByTopic(view);
  const strengths = new Set(view.strengths ?? []);
  return (
    <section className={styles.section} aria-labelledby="skills-h">
      <h2 id="skills-h">Skills map</h2>
      <p className={styles.lede}>
        Every idea she has shown Kite, by topic. Only what she does counts: teaching it back, a check question, or a game.
        Kite&apos;s own explanations never raise a level.
      </p>
      <ul className={styles.levelKey} aria-label="Levels">
        {LEVELS.map((l) => (
          <li key={l}>
            <Pips level={l} />
            {LEVEL_WORDS[l]}
          </li>
        ))}
      </ul>
      {topics.length === 0 && <p className={styles.quiet}>Nothing shown yet at this grade.</p>}
      <div className={styles.topics}>
        {topics.map((t) => (
          <div key={t.topic} className={styles.topic}>
            <h3>
              {t.name}
              {strengths.has(t.topic) && <span className={styles.strengthTag}>Strength</span>}
            </h3>
            <p className={styles.quiet}>
              {t.solid} of {t.concepts.length} solid
            </p>
            <ul>
              {t.concepts.map((c) => (
                <li key={c.concept_id} className={styles.concept}>
                  <span>{c.name}</span>
                  <span className={styles.level}>
                    <Pips level={c.level} />
                    {LEVEL_WORDS[c.level]}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function Pips({ level }: { level: Level }) {
  const filled = LEVELS.indexOf(level);
  return (
    <span className={styles.pips} aria-hidden>
      {[1, 2, 3].map((i) => (
        <span key={i} data-on={i <= filled} />
      ))}
    </span>
  );
}
