"use client";

import type { KiteEvent } from "@kite/client";
import { useEffect, useState } from "react";
import { KiteMark } from "@/components/kit/KiteMark";
import { bandFor, type Band } from "@/lib/band";
import { useBrain, useBrainEvents, KID_ID } from "@/lib/brain";

/** Foundation stub: proves the cookie, /me and the event stream. The Kite OS helper replaces it. */
export function OsScreen({ device }: { device: "os" | "handheld" }) {
  const brain = useBrain(device);
  const [band, setBand] = useState<Band>("g35");
  const [events, setEvents] = useState<KiteEvent[]>([]);
  useEffect(() => {
    brain.get<{ name: string; grade: number }>(`/kids/${KID_ID}/me`).then((me) => setBand(bandFor(me.grade)), () => {});
  }, [brain]);
  useBrainEvents(brain, (e) => setEvents((list) => [e, ...list].slice(0, 20)));
  return (
    <main className="kid" data-band={band} style={{ display: "grid", justifyItems: "center", gap: 16, padding: 32 }}>
      <KiteMark size={110} />
      <p data-testid="event-count">{events.length} events</p>
      <p data-testid="last-event">{events[0]?.type ?? "none yet"}</p>
    </main>
  );
}
