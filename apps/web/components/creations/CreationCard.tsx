"use client";

import type { Brain } from "@kite/client";
import type { CreationEntry } from "@/lib/creations";

export interface CreationCardProps {
  brain: Brain;
  creation: CreationEntry;
}

/**
 * One movie or game on the kid's screen: progress while it's made, then the player.
 * Stub from the foundation with its final props. The creations helper fills it in.
 */
export function CreationCard({ creation }: CreationCardProps) {
  const { kind, status, progress } = creation;
  return (
    <div className="stub" data-creation={creation.id}>
      {kind === "movie" ? "Movie" : "Game"} {status === "making" && progress ? `${progress.step} of ${progress.total}` : status}
    </div>
  );
}
