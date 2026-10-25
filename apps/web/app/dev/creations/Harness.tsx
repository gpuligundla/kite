"use client";

import { useEffect, useState } from "react";
import { CreationCard } from "@/components/creations/CreationCard";
import type { Band } from "@/lib/band";
import { useBrain, useBrainEvents } from "@/lib/brain";
import { reduceCreations, type CreationEntry, type Creations } from "@/lib/creations";
import { setSoundBand } from "@/lib/sound";

export type Preview = "movie" | "game" | "brandNew";
const TOTAL: Record<Preview, number> = { movie: 6, game: 1, brandNew: 8 };

/** Renders one CreationCard for any creation id. With no id, it shows every creation the stream reports while it's open. */
export function Harness(props: { id: string; band: Band; making?: Preview; step: number }) {
  const brain = useBrain("os");
  const [band, setBand] = useState(props.band);
  const [draft, setDraft] = useState(props.id);
  const [id, setId] = useState(props.id);
  const [making, setMaking] = useState(props.making);
  const [step, setStep] = useState(props.step);
  const [looked, setLooked] = useState<CreationEntry | "missing">();
  const [live, setLive] = useState<Creations>([]);

  useEffect(() => setSoundBand(band), [band]);
  useBrainEvents(brain, (e) => setLive((list) => reduceCreations(list, e)));
  useEffect(() => {
    if (!id) return;
    setLooked(undefined);
    brain.get<{ kind: CreationEntry["kind"]; status: "pending" | "ready" | "fallback" }>(`/creations/${id}`).then(
      (c) => setLooked({ id, kind: c.kind, status: c.status === "pending" ? "making" : c.status }),
      () => setLooked("missing"),
    );
  }, [brain, id]);

  const entry: CreationEntry | undefined = !id
    ? undefined
    : making
      ? { id, kind: making === "movie" ? "movie" : "game", status: "making", progress: { step, total: TOTAL[making] } }
      : (live.find((c) => c.id === id) ?? (looked === "missing" ? undefined : looked));

  return (
    <main className="kid" data-band={band} style={{ padding: 16, display: "grid", gap: 24, justifyItems: "center", alignContent: "start" }}>
      <form
        style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", fontSize: 14, width: "min(100%, 920px)" }}
        onSubmit={(e) => {
          e.preventDefault();
          setId(draft.trim());
        }}
      >
        <input name="id" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="creation id" style={{ flex: "1 1 280px", padding: 6 }} />
        <button type="submit">Show</button>
        <select name="band" value={band} onChange={(e) => setBand(e.target.value as Band)}>
          {(["k2", "g35", "g68", "g912"] as const).map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
        <select name="making" value={making ?? ""} onChange={(e) => setMaking((e.target.value || undefined) as Preview | undefined)}>
          <option value="">as it is</option>
          <option value="movie">making a movie</option>
          <option value="game">making a game</option>
          <option value="brandNew">building a brand-new game</option>
        </select>
        <input name="step" type="number" min={0} max={8} value={step} onChange={(e) => setStep(Number(e.target.value))} style={{ width: 56 }} />
      </form>
      {looked === "missing" && !making && <p>No creation with that id.</p>}
      {entry && <CreationCard key={entry.id} brain={brain} creation={entry} />}
      {!id && live.map((c) => <CreationCard key={c.id} brain={brain} creation={c} />)}
    </main>
  );
}
