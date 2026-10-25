"use client";

import { useEffect, useState } from "react";
import type { Loaded } from "@/components/creations/CreationCard";
import { StoryPlayer } from "@/components/story/StoryPlayer";
import type { Band } from "@/lib/band";
import { useBrain } from "@/lib/brain";
import { setSoundBand } from "@/lib/sound";

/** One story by creation id, the way the kid's screen will show it once CreationCard sends stories here. */
export function StoryHarness({ id, band }: { id: string; band: Band }) {
  const brain = useBrain("os");
  const [data, setData] = useState<Loaded | "missing">();

  useEffect(() => setSoundBand(band), [band]);
  useEffect(() => {
    if (!id) return;
    brain.get<Loaded>(`/creations/${id}`).then(setData, () => setData("missing"));
  }, [brain, id]);

  return (
    <main className="kid" data-band={band} style={{ padding: 16, display: "grid", justifyItems: "center", alignContent: "start" }}>
      <div style={{ width: "min(100%, 1000px)" }}>
        {!id && <p>Add ?id=&lt;creation id&gt; to the address.</p>}
        {data === "missing" && <p>No story with that id.</p>}
        {data && data !== "missing" && (
          <StoryPlayer
            brain={brain}
            creation={{ id: data.id, kind: data.kind, status: data.status === "pending" ? "making" : data.status }}
            data={data}
          />
        )}
      </div>
    </main>
  );
}
