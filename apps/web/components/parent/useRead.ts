"use client";

import type { Brain } from "@kite/client";
import { useEffect, useState } from "react";

/** One GET when the component mounts. Parent reads write access receipts, so this never repeats on its own. */
export function useRead<T>(brain: Brain, path: string): { data?: T; error?: string } {
  const [state, setState] = useState<{ data?: T; error?: string }>({});
  useEffect(() => {
    let current = true;
    brain.get<T>(path).then(
      (data) => current && setState({ data }),
      (err: Error) => current && setState({ error: err.message }),
    );
    return () => {
      current = false;
    };
  }, [brain, path]);
  return state;
}
