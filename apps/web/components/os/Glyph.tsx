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
  keyboard: "M3 6h18v12H3Z M7 10h.01 M11 10h.01 M15 10h.01 M8 14h8",
  home: "M4 11l8-7 8 7 M6 9.5V20h12V9.5 M10 20v-5h4v5",
  fresh: "M12 3v4 M12 17v4 M3 12h4 M17 12h4 M6 6l2.5 2.5 M15.5 15.5L18 18 M18 6l-2.5 2.5 M8.5 15.5L6 18",
  plus: "M12 5v14 M5 12h14",
  picture: "M4 5h16v14H4Z M4 16l5-5 4 4 2-2 5 5 M15.5 9.5h.01",
  pdf: "M6 3h8l4 4v14H6Z M14 3v4h4 M9 12h6 M9 16h6",
  chats: "M12 7v5l3 2 M3.5 12a8.5 8.5 0 1 0 2.5-6 M3 4v4h4",
  remember: "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10Z",
  back: "M19 12H5 M11 5l-7 7 7 7",
  book: "M4 5.5c2.5-1.5 5.5-1.5 8 0v14c-2.5-1.5-5.5-1.5-8 0Z M12 5.5c2.5-1.5 5.5-1.5 8 0v14c-2.5-1.5-5.5-1.5-8 0",
  moon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z",
  smile: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M8.5 14a4.5 4.5 0 0 0 7 0 M9 9.5h.01 M15 9.5h.01",
  bulb: "M9 18h6 M10 21h4 M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z",
  board: "M3 5h18v11H3Z M8 20l4-4 4 4 M7 9h6 M7 12h4",
  list: "M9 6h11 M9 12h11 M9 18h11 M4 6l1 1 2-2 M4 12l1 1 2-2 M4 18l1 1 2-2",
  timer: "M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z M12 9v4l2.5 2 M10 2h4",
  calendar: "M4 6h16v14H4Z M4 10h16 M8 3v5 M16 3v5",
  star: "M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6L3.4 9.3l6-.7Z",
  call: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z",
  message: "M4 5h16v11H9l-5 4Z",
  pin: "M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  wifi: "M2.5 9a14 14 0 0 1 19 0 M5.5 12.5a9.5 9.5 0 0 1 13 0 M8.5 16a5 5 0 0 1 7 0 M12 19.5h.01",
  bus: "M6 4h12a2 2 0 0 1 2 2v10H4V6a2 2 0 0 1 2-2Z M4 11h16 M7 19v-3 M17 19v-3 M7.5 13.5h.01 M16.5 13.5h.01",
  sparkle: "M12 3c.6 4.2 2.8 6.4 7 7-4.2.6-6.4 2.8-7 7-.6-4.2-2.8-6.4-7-7 4.2-.6 6.4-2.8 7-7Z M19 16c.3 1.6 1 2.3 2.5 2.5-1.5.3-2.2 1-2.5 2.5-.3-1.5-1-2.2-2.5-2.5 1.5-.2 2.2-.9 2.5-2.5Z",
  chevron: "M9 6l6 6-6 6",
  lock: "M6 11h12v9H6Z M9 11V8a3 3 0 0 1 6 0v3",
  people: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M2.5 20a6.5 6.5 0 0 1 13 0 M16 4.5a3.5 3.5 0 0 1 0 6.5 M18 14a5.5 5.5 0 0 1 3.5 6",
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
