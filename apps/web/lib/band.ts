/** The four grade bands the brain also uses for voices and reading level. The kid screen's look follows them. */
export type Band = "k2" | "g35" | "g68" | "g912";

export function bandFor(grade: number): Band {
  if (grade <= 2) return "k2";
  if (grade <= 5) return "g35";
  if (grade <= 8) return "g68";
  return "g912";
}

/**
 * Springs for things that should feel alive (Kite, a new answer, a creation card). Younger kids get more bounce;
 * teens get none. Values from Emil Kowalski's animation rules: bounce stays within 0.1-0.3 or zero.
 */
export const SPRING: Record<Band, { type: "spring"; duration: number; bounce: number }> = {
  k2: { type: "spring", duration: 0.5, bounce: 0.3 },
  g35: { type: "spring", duration: 0.45, bounce: 0.2 },
  g68: { type: "spring", duration: 0.4, bounce: 0.1 },
  g912: { type: "spring", duration: 0.35, bounce: 0 },
};
