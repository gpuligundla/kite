"use client";

import type { Brain } from "@kite/client";
import { KID_ID } from "@/lib/brain";
import type { Creation } from "./model";
import styles from "./parent.module.css";
import { useRead } from "./useRead";

/** Rendered MP4s, newest first as the brain sends them. The files load from /creations through the web origin. */
export function Movies({ brain, name }: { brain: Brain; name: string }) {
  const { data, error } = useRead<Creation[]>(brain, `/kids/${KID_ID}/movies`);
  return (
    <div className={styles.section}>
      <h2>{name}&apos;s movies</h2>
      <p className={styles.lede}>Cartoons Kite made with her, narrated and starring her characters.</p>
      {error && <p className={styles.error}>Movies didn&apos;t load: {error}. Reload to try again.</p>}
      {data && data.length === 0 && <p className={styles.quiet}>No movies yet. When she asks Kite to make one, it shows up here.</p>}
      <ul className={styles.movies}>
        {data?.map((m) =>
          m.video_url ? (
            <li key={m.id}>
              {/* #t=0.1 makes the browser paint a first frame instead of a black box. */}
              <video controls preload="metadata" src={`${m.video_url}#t=0.1`} />
              <span>{m.storyboard?.title ?? "A movie"}</span>
              <a href={m.video_url} download>
                Download
              </a>
            </li>
          ) : null,
        )}
      </ul>
    </div>
  );
}
