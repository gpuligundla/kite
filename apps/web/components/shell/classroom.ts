/** GET /kids/{kid}/classroom, as the brain sends it. Statuses match what the homework guard will do. */
export type ClassStatus = "upcoming" | "open" | "exam_live" | "closed";
export interface Course {
  id: string;
  name: string;
  teacher: string;
}
export interface Assignment {
  id: string;
  course_id: string;
  title: string;
  kind: "homework" | "quiz";
  status: ClassStatus;
  unlock_at: string | null;
  due_at: string | null;
  lock_at: string | null;
  description: string;
  questions: string[];
}
export interface Classroom {
  courses: Course[];
  assignments: Assignment[];
}
/** GET /kids/{kid}/creations: what she can open in My creations. */
export interface MadeThing {
  id: string;
  kind: "movie" | "game" | "story";
  title: string;
}
/** GET /kids/{kid}/approved-contacts: names only. */
export interface Contact {
  id: string;
  name: string;
}

/** What Kite does with each status, in kid words. */
export const KITE_WILL: Record<ClassStatus, string> = {
  upcoming: "Not open yet",
  open: "Kite can give you hints",
  exam_live: "Kite is paused for this quiz",
  closed: "Kite can explain the answers now",
};
export const STATUS_NAME: Record<ClassStatus, string> = {
  upcoming: "Coming up",
  open: "To do",
  exam_live: "Happening now",
  closed: "Finished",
};

/** The words a turn carries when Ask Kite is opened from an assignment, so the homework guard knows which one. */
export const aboutWords = (title: string, text: string) => `About my assignment '${title}': ${text}`;

const DAY_MS = 86_400_000;
const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function dayWord(at: Date, now: Date): string {
  const days = Math.round((midnight(at) - midnight(now)) / DAY_MS);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 1 && days < 7) return at.toLocaleDateString(undefined, { weekday: "long" });
  return at.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
export const clock = (at: Date) => at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** "Due tomorrow at 4:44 AM", "Closed Oct 18", "Opens Monday". */
export function whenLabel(a: Assignment, now: Date): string {
  if (a.status === "upcoming" && a.unlock_at) return `Opens ${dayWord(new Date(a.unlock_at), now)}`;
  if (a.status === "closed") {
    const end = a.lock_at ?? a.due_at;
    return end ? `Closed ${dayWord(new Date(end), now)}` : "Closed";
  }
  if (!a.due_at) return "No due date";
  const due = new Date(a.due_at);
  return `Due ${dayWord(due, now)} at ${clock(due)}`;
}

/** Live quizzes first, then the soonest due; finished work last. */
export function byUrgency(list: readonly Assignment[]): Assignment[] {
  const rank: Record<ClassStatus, number> = { exam_live: 0, open: 1, upcoming: 2, closed: 3 };
  const due = (a: Assignment) => (a.due_at ? Date.parse(a.due_at) : Number.MAX_SAFE_INTEGER);
  return [...list].sort((a, b) => rank[a.status] - rank[b.status] || due(a) - due(b));
}
