// Sprites are inert SVG images behind data: URLs, so any script inside one never runs.
// Real art comes from the brain: pass GET /creations/{id}'s `sprites` map to KiteMovie as it is.
// Slugs it doesn't list get a flat shape plus an initial.

const SHAPES: Record<string, string> = {
  circle: '<circle cx="32" cy="32" r="28"/>',
  square: '<rect x="6" y="6" width="52" height="52" rx="8"/>',
  triangle: '<polygon points="32,4 60,58 4,58"/>',
  star: '<polygon points="32,4 40,24 62,24 44,38 50,60 32,47 14,60 20,38 2,24 24,24"/>',
  heart: '<path d="M32 58 L8 32 A14 14 0 0 1 32 16 A14 14 0 0 1 56 32 Z"/>',
  drop: '<path d="M32 4 C32 4 10 30 10 42 A22 22 0 0 0 54 42 C54 30 32 4 32 4 Z"/>',
  sun: '<circle cx="32" cy="32" r="18"/>',
  rocket: '<path d="M32 2 Q50 20 44 50 L20 50 Q14 20 32 2 Z"/><path d="M20 50 L12 62 L24 56 Z"/><path d="M44 50 L52 62 L40 56 Z"/>',
};
const COLORS = ["#ef5350", "#ffa726", "#66bb6a", "#42a5f5", "#ab47bc", "#26a69a"];

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** The sprite for a slug: the caller's art (a URL or raw <svg> markup) first, then a flat generated badge. */
export function resolveSprite(slug: string, sprites: Record<string, string> = {}): string {
  const art = sprites[slug];
  if (art) return art.trimStart().startsWith("<svg") ? svgDataUrl(art) : art;
  let hash = 0;
  for (const ch of slug) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const color = COLORS[hash % COLORS.length];
  const shape = SHAPES[slug] ?? SHAPES.circle;
  const initial = SHAPES[slug] ? "" : `<text x="32" y="43" font-size="30" font-family="Arial" font-weight="700" text-anchor="middle" fill="#fff">${slug[0]?.toUpperCase() ?? ""}</text>`;
  return svgDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g fill="${color}">${shape}</g>${initial}</svg>`,
  );
}
