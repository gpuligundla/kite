"use client";

import type { Brain } from "@kite/client";
import { useState } from "react";
import { KID_ID } from "@/lib/brain";
import { KID, type Creation } from "./model";
import ui from "./parent.module.css";
import t from "./tabs.module.css";
import { useRead } from "./useRead";

type Movie = Creation & { storyboard: NonNullable<Creation["storyboard"]>; video_url: string };
const isMovie = (c: Creation): c is Movie => !!c.storyboard && !!c.video_url;

/**
 * Her own characters (from her profile, like Rexy) in order of first appearance. Movies also name props such as "Sun",
 * which aren't hers.
 */
const castOf = (m: Movie, characters: string[]) =>
  [...new Set(m.storyboard.scenes.flatMap((s) => s.actors.map((a) => a.name)))].filter((n): n is string => !!n && characters.includes(n));

/**
 * Rendered movies, newest first as the brain sends them. The files load from /creations through the web origin.
 * Games and stories have no parent route yet, so this tab is movies only.
 */
export function Creations({ brain, characters }: { brain: Brain; characters: string[] }) {
  const { data, error } = useRead<Creation[]>(brain, `/kids/${KID_ID}/movies`);
  const movies = (data ?? []).filter(isMovie);
  const [pick, setPick] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const featured = movies.find((m) => m.id === pick) ?? movies[0];
  const cast = new Map<string, { sprite: string; movies: number }>();
  for (const m of movies)
    for (const name of castOf(m, characters)) {
      const sprite = m.storyboard.scenes.flatMap((s) => s.actors).find((a) => a.name === name)!.sprite;
      cast.set(name, { sprite, movies: (cast.get(name)?.movies ?? 0) + 1 });
    }

  if (error) return <p className={ui.error}>Her movies didn&apos;t load: {error}. Reload to try again.</p>;
  if (!data) return <p className={ui.loading}>Loading her movies…</p>;
  if (!featured)
    return (
      <section className={`${ui.hero} ${t.cEmpty}`}>
        <h2 className={t.heroTitle}>No movies yet</h2>
        <p className={ui.lede}>When {KID.name} asks Kite to turn an answer into a movie, the finished cartoon shows up here to watch and download.</p>
      </section>
    );

  const check = featured.storyboard.check;
  return (
    <div className={t.creations}>
      <section className={`${ui.hero} ${t.cHero}`} aria-labelledby="movie-h">
        <div className={t.screen}>
          {playing === featured.id ? (
            <video key={featured.id} controls autoPlay src={featured.video_url} className={t.video} />
          ) : (
            <button className={t.playable} onClick={() => setPlaying(featured.id)} aria-label={`Play ${featured.storyboard.title}`}>
              <Poster movie={featured} big />
              <span className={t.play} aria-hidden>
                <svg viewBox="0 0 24 24">
                  <path d="M8 5.5v13l11-6.5z" />
                </svg>
              </span>
            </button>
          )}
        </div>
        <div className={t.movieInfo}>
          <h2 id="movie-h" className={t.heroTitle}>
            {featured.storyboard.title}
          </h2>
          <p className={ui.quiet}>
            {featured.storyboard.scenes.length} scenes
            {castOf(featured, characters).length > 0 && `, starring ${new Intl.ListFormat("en-US").format(castOf(featured, characters))}`}.
          </p>
          <ol className={t.sceneStrip} aria-label="Scenes">
            {featured.storyboard.scenes.map((s, i) => (
              <li key={i} style={{ background: `linear-gradient(180deg, ${s.palette.sky} 0 62%, ${s.palette.ground} 62%)` }} title={`Scene ${i + 1}: ${s.background}`} />
            ))}
          </ol>
          {check && (
            <div className={t.check}>
              <h3>The question Kite asked at the end</h3>
              <p>{check.question}</p>
              <ul>
                {check.choices.map((c, i) => (
                  <li key={i} data-right={i === check.correct_index}>
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <a href={featured.video_url} download className={ui.ghostButton}>
            Download the movie
          </a>
        </div>
      </section>

      <section className={t.reel} aria-labelledby="reel-h">
        <h2 id="reel-h">
          {movies.length} {movies.length === 1 ? "movie" : "movies"} she made with Kite
        </h2>
        <ul className={t.reelGrid}>
          {movies.map((m) => (
            <li key={m.id}>
              <button className={t.reelItem} aria-pressed={m.id === featured.id} onClick={() => setPick(m.id)}>
                <Poster movie={m} />
                <span>{m.storyboard.title}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className={`${ui.panel} ${t.castPanel}`} aria-labelledby="cast-h">
        <h2 id="cast-h">Her cast</h2>
        {cast.size === 0 && <p className={ui.empty}>Characters she invents, like a favorite toy, show up here once they star in a movie.</p>}
        <ul>
          {[...cast].map(([name, c]) => (
            <li key={name}>
              <img src={`/creations/sprites/${c.sprite}`} alt="" />
              <div>
                <strong>{name}</strong>
                <span>
                  In {c.movies} of her {movies.length} movies
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** A still drawn from the first scene's own sky, ground and actors, so nothing has to load a video to look good. */
function Poster({ movie, big = false }: { movie: Movie; big?: boolean }) {
  const scene = movie.storyboard.scenes[0];
  return (
    <span
      className={t.poster}
      data-big={big}
      style={{ background: `linear-gradient(180deg, ${scene.palette.sky} 0%, ${scene.palette.sky} 64%, ${scene.palette.ground} 64%)` }}
      aria-hidden
    >
      {scene.actors.slice(0, 2).map((a, i) => (
        <img key={i} src={`/creations/sprites/${a.sprite}`} alt="" />
      ))}
    </span>
  );
}
