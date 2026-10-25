"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { KiteMark } from "@/components/kit/KiteMark";
import { bandFor, type Band } from "@/lib/band";
import { KID_ID, useBrain, useBrainEvents } from "@/lib/brain";
import styles from "./remember.module.css";

/** GET /kids/{kid}/kid-view: plain strings, never levels or scores. */
type KidView = { interests: string[]; characters: string[]; moments: string[]; deep_topics: string[] };

type Words = {
  title: string;
  lead: string;
  interests: string;
  characters: string;
  deep: string;
  moments: string;
  forget: string;
};
const YOUNG: Words = {
  title: "What Kite remembers about you",
  lead: "Kite keeps these so it can make movies and games you'll love.",
  interests: "Things you love",
  characters: "Your favorite characters",
  deep: "Things you know a lot about",
  moments: "Times Kite remembers",
  forget: "Kite will forget the last thing you said.",
};
const OLDER: Words = {
  title: "What Kite remembers",
  lead: "Kite uses these so its answers, movies and games fit you.",
  interests: "What you're into",
  characters: "Favorite characters",
  deep: "Topics you know deeply",
  moments: "Moments Kite remembers",
  forget: "Kite forgets the last thing you told it.",
};
const WORDS: Record<Band, Words> = { k2: YOUNG, g35: YOUNG, g68: OLDER, g912: OLDER };
const FIRST_MOMENTS = 6;

// Interests arrive as catalog topic slugs. Three of them pair two ideas; the rest read fine with spaces.
const PAIRS: Record<string, string> = { area_perimeter: "Area and perimeter", cells_genetics: "Cells and genetics", earth_space: "Earth and space" };
const plain = (s: string) => {
  const t = PAIRS[s] ?? s.replaceAll("_", " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export function RememberScreen({ grade }: { grade?: number }) {
  const brain = useBrain("os");
  const [band, setBand] = useState<Band>(grade === undefined ? "g35" : bandFor(grade));
  const [view, setView] = useState<KidView | "error">();
  const [allMoments, setAllMoments] = useState(false);

  useEffect(() => {
    if (grade !== undefined) return;
    brain.get<{ grade: number }>(`/kids/${KID_ID}/me`).then((me) => setBand(bandFor(me.grade)), () => {});
  }, [brain, grade]);

  const load = useCallback(() => {
    brain.get<KidView>(`/kids/${KID_ID}/kid-view`).then(setView, () => setView("error"));
  }, [brain]);
  useEffect(load, [load]);
  // "Forget that" in a turn removes something; show the list without it.
  useBrainEvents(brain, (e) => {
    if (e.type === "routed" && e.route === "forget") load();
  });

  const w = WORDS[band];
  const moments = view && view !== "error" ? view.moments : [];
  const shown = allMoments ? moments : moments.slice(0, FIRST_MOMENTS);

  return (
    <main className={`kid ${styles.page}`} data-band={band}>
      <div className={styles.column}>
        <Link href="/os" className={styles.back}>
          Back to Kite
        </Link>
        <header className={styles.top}>
          <div className={styles.mark}>
            <KiteMark size={96} />
          </div>
          <h1 className={styles.h1}>{w.title}</h1>
          <p className={styles.lead}>{view === "error" ? "Kite couldn't load this. Check the connection, then refresh the page." : w.lead}</p>
        </header>
  
        {view && view !== "error" && (
          <div className={styles.sections}>
            <Section title={w.interests} empty="Tell Kite about things you like and they'll show up here.">
              {view.interests.length > 0 && (
                <ul className={styles.chips}>
                  {view.interests.map((s) => (
                    <li key={s}>{plain(s)}</li>
                  ))}
                </ul>
              )}
            </Section>
  
            <Section title={w.characters} empty="Your favorite characters from Kite's movies will live here.">
              {view.characters.length > 0 && (
                <ul className={styles.names}>
                  {view.characters.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              )}
            </Section>
  
            <Section title={w.deep} empty="Keep exploring with Kite. Topics you dig into show up here.">
              {view.deep_topics.length > 0 && (
                <ul className={styles.chips}>
                  {view.deep_topics.map((s) => (
                    <li key={s}>{plain(s)}</li>
                  ))}
                </ul>
              )}
            </Section>
  
            <Section title={w.moments} empty="Things you do with Kite will show up here.">
              {moments.length > 0 && (
                <>
                  <ul className={styles.moments}>
                    {shown.map((m, i) => (
                      <li key={`${i}-${m}`}>{m}</li>
                    ))}
                  </ul>
                  {moments.length > FIRST_MOMENTS && (
                    <button type="button" className={styles.more} onClick={() => setAllMoments((v) => !v)}>
                      {allMoments ? "Show fewer" : `See all ${moments.length}`}
                    </button>
                  )}
                </>
              )}
            </Section>
          </div>
        )}
  
        <aside className={styles.forget}>
          <h2 className={styles.h2}>Want Kite to forget something?</h2>
          <p>
            Just say <q className={styles.say}>forget that</q> to Kite. {w.forget}
          </p>
        </aside>
      </div>
    </main>
  );
}

function Section({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.h2}>{title}</h2>
      {children || <p className={styles.empty}>{empty}</p>}
    </section>
  );
}
