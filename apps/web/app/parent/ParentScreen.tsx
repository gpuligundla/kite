"use client";

import type { KiteEvent } from "@kite/client";
import { useState } from "react";
import { useBrain, useBrainEvents } from "@/lib/brain";

/** Foundation stub: proves the parent cookie and a long-lived event stream. The parent helper replaces it. */
export function ParentScreen() {
  const brain = useBrain("parent");
  const [events, setEvents] = useState<KiteEvent[]>([]);
  useBrainEvents(brain, (e) => setEvents((list) => [e, ...list].slice(0, 20)));
  return (
    <main className="grown" style={{ padding: 32 }}>
      <h1>Grown-up view</h1>
      <p data-testid="event-count">{events.length} events</p>
      <p data-testid="last-event">{events[0]?.type ?? "none yet"}</p>
    </main>
  );
}
