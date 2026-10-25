"use client";

import type { Brain } from "@kite/client";
import { Policy } from "./Policy";
import { KID, plainSummary, topicName, type Card, type Grade, type PolicyAction } from "./model";
import ui from "./parent.module.css";
import t from "./tabs.module.css";

/** How many big questions each school year, as a strip of columns: one series, so one color and no legend. */
function PerYear({ cards, grade }: { cards: Card[]; grade: Grade }) {
  const counts = Array.from({ length: grade }, (_, i) => ({ grade: i + 1, n: cards.filter((c) => c.grade === i + 1).length }));
  const max = Math.max(1, ...counts.map((c) => c.n));
  return (
    <figure className={t.perYear}>
      <figcaption>Big questions each school year</figcaption>
      <ol aria-label={counts.map((c) => `Grade ${c.grade}: ${c.n}`).join(", ")}>
        {counts.map((c) => (
          <li key={c.grade} aria-hidden>
            <span>{c.n || ""}</span>
            <i style={{ height: `${(c.n / max) * 100}%` }} />
            <b>{c.grade}</b>
          </li>
        ))}
      </ol>
    </figure>
  );
}

const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const dayOnly = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/** Times she asked about a topic you chose to hear about, newest first, and the choices that make them. */
export function Questions({
  brain, cards, grade, policy, onPolicy,
}: {
  brain: Brain;
  cards: Card[];
  grade: Grade;
  policy: Record<string, PolicyAction>;
  onPolicy: (set: (p: Record<string, PolicyAction>) => Record<string, PolicyAction>) => void;
}) {
  const [latest] = cards;
  const byGrade = [...new Set(cards.map((c) => c.grade))].map((g) => ({ grade: g, cards: cards.filter((c) => c.grade === g) }));
  const thisYear = cards.filter((c) => c.grade === grade).length;

  return (
    <div className={t.questions}>
      <section className={`${ui.hero} ${t.qHero}`} aria-labelledby="latest-h">
        {latest ? (
          <>
            <h2 id="latest-h" className={t.heroTitle}>
              {KID.name} asked about {topicName(latest.topic).toLowerCase()} on {dayOnly.format(new Date(latest.at))}
            </h2>
            <p className={ui.quiet}>
              Grade {latest.grade}, {day.format(new Date(latest.at))}. {cards.length} big questions by the end of grade {grade},{" "}
              {thisYear === 0 ? "none" : thisYear} this year.
            </p>
            <blockquote className={t.answer}>
              <p>{plainSummary(latest.summary)}</p>
              <footer>The start of Kite&apos;s answer</footer>
            </blockquote>
            <p className={t.starter}>
              <strong>Start a conversation</strong>
              {latest.starter}
            </p>
            <PerYear cards={cards} grade={grade} />
          </>
        ) : (
          <>
            <h2 id="latest-h" className={t.heroTitle}>
              No big questions yet
            </h2>
            <p className={ui.lede}>
              When {KID.name} asks about a topic you chose to hear about, Kite answers her and you get a card here with the
              start of its answer and a way to bring it up with her.
            </p>
          </>
        )}
      </section>

      <Policy brain={brain} family={KID.family} name={KID.name} policy={policy} onChange={onPolicy} />

      {byGrade.length > 0 && (
        <section className={t.qAll} aria-labelledby="all-h">
          <h2 id="all-h">Every big question</h2>
          <ol className={t.timeline}>
            {byGrade.map(({ grade: g, cards: list }) => (
              <li key={g} className={t.yearRow}>
                <div className={t.yearMark}>
                  <span className={ui.figure}>{g}</span>
                  <span>Grade</span>
                </div>
                <ul className={t.qList}>
                  {list.map((c) => (
                    <li key={c.card_id} className={ui.panel}>
                      <p className={t.qMeta}>
                        <strong>{topicName(c.topic)}</strong>
                        <time dateTime={c.at}>{day.format(new Date(c.at))}</time>
                      </p>
                      <p className={t.qSummary}>{plainSummary(c.summary)}</p>
                      <p className={t.qStarter}>Start a conversation: {c.starter}</p>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
