const PATHS = {
  mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z M6 11a6 6 0 0 0 12 0 M12 17v4",
  send: "M4 12h14 M12 5l7 7-7 7",
  camera: "M4 8h3l2-3h6l2 3h3v11H4Z M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
  movie: "M4 6h16v12H4Z M4 10h16 M8 6l-2 4 M13 6l-2 4 M18 6l-2 4",
  game: "M7 8h10a4 4 0 0 1 0 8c-1.5 0-2.5-1-3-2h-4c-.5 1-1.5 2-3 2a4 4 0 0 1 0-8Z M8 10.5v3 M6.5 12h3 M15.5 11.5h.01 M17 13h.01",
  computer: "M5 6h14v9H5Z M3 18h18",
  phone: "M8 3h8v18H8Z M11 18h2",
  soundOn: "M4 9h4l5-4v14l-5-4H4Z M16 9a4 4 0 0 1 0 6 M18.5 6.5a7.5 7.5 0 0 1 0 11",
  soundOff: "M4 9h4l5-4v14l-5-4H4Z M16 9l5 6 M21 9l-5 6",
  teach: "M4 6h16v10H8l-4 4Z M8 10h8 M8 13h5",
  close: "M6 6l12 12 M18 6L6 18",
  deeper: "M12 4v14 M6 12l6 6 6-6",
} as const;

export type GlyphName = keyof typeof PATHS;

/** Line icons drawn in the kite's ink stroke. Decorative: the control next to it carries the words. */
export function Glyph({ name, size = 22 }: { name: GlyphName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
