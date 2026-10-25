import type { components } from "../../../../packages/client/src/contract";

type Schemas = components["schemas"];
export type Report = Schemas["CounselorAlertView"];
export type CaseChange = Schemas["CaseChange"];
export type CaseStatus = CaseChange["status"];
export type Student = Schemas["CounselorStudentView"];
export type Receipt = Schemas["ReceiptView"];
type AlertKind = Report["kinds"][number];

type Tone = "urgent" | "open" | "care" | "done";

/** The case, in the order a counselor usually works it. `action` names the button that moves a report there. */
export const STATUSES: readonly { id: CaseStatus; label: string; action: string; tone: Tone; detail: string }[] = [
  { id: "new", label: "New", action: "Mark as new", tone: "urgent", detail: "Nobody has worked this report yet." },
  { id: "reviewing", label: "Reviewing", action: "Start review", tone: "open", detail: "You're reading it and deciding next steps." },
  { id: "met_with_student", label: "Met with student", action: "Met with student", tone: "care", detail: "You've talked with her privately." },
  { id: "reported", label: "Reported", action: "Reported to CPS", tone: "care", detail: "Child protective services has the report." },
  { id: "closed", label: "Closed", action: "Close case", tone: "done", detail: "Handed off; nothing left for you to do on it." },
];
export const statusOf = (id: CaseStatus) => STATUSES.find((s) => s.id === id)!;
export const nextStatus = (id: CaseStatus): CaseStatus => STATUSES[Math.min(STATUSES.findIndex((s) => s.id === id) + 1, STATUSES.length - 1)].id;

const KIND_WORDS: Record<AlertKind, string> = {
  abuse: "Possible abuse",
  self_harm: "Self-harm",
  bullying: "Bullying",
  stranger: "A stranger",
  sos: "SOS",
};
export const kindWords = (kinds: AlertKind[]) => kinds.map((k) => KIND_WORDS[k]).join(" and ");

const dayTime = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const day = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" });
const shortDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
export const formatWhen = (iso: string) => dayTime.format(new Date(iso));
const formatDay = (iso: string) => day.format(new Date(iso));
export const formatShortDay = (iso: string) => shortDay.format(new Date(iso));
export const formatTime = (iso: string) => time.format(new Date(iso));

const rtf = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
export function ago(iso: string, now: number) {
  const min = Math.round((now - Date.parse(iso)) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return rtf.format(-min, "minute");
  if (min < 24 * 60) return rtf.format(-Math.round(min / 60), "hour");
  return rtf.format(-Math.round(min / (24 * 60)), "day");
}

/** "40 minutes", "13 hours", "7 days": how long a case step took. */
export function span(fromIso: string, toIso: string) {
  const min = Math.max(1, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000));
  if (min < 90) return `${min} minute${min === 1 ? "" : "s"}`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} hours`;
  return `${Math.round(h / 24)} days`;
}

/** When each step of a report's case was first reached, measured from the report itself. */
export function pace(r: Report): { status: CaseStatus; after: string }[] {
  const seen = new Set<CaseStatus>();
  return r.history.flatMap((c) => {
    if (seen.has(c.status) || c.status === "new") return [];
    seen.add(c.status);
    return [{ status: c.status, after: span(r.at, c.at) }];
  });
}

/** Counts by status, every status present, from the reports themselves so a change shows at once. */
export function countByStatus(reports: Report[]): Record<CaseStatus, number> {
  const counts = Object.fromEntries(STATUSES.map((s) => [s.id, 0])) as Record<CaseStatus, number>;
  for (const r of reports) counts[r.status] += 1;
  return counts;
}

interface LogRow {
  at: string;
  words: string;
  change: boolean;
}

/**
 * The access trail in words, grouped by local day, newest first. The brain writes "alert <id>" per report read,
 * "case <id> <status>[ with a note]" per change and "student profile". One page load reads every report at once, so
 * reads in the same minute fold into one line.
 */
export function logRows(receipts: Receipt[], reports: Map<string, Report>, name: string): { day: string; rows: LogRow[] }[] {
  const reportWords = (id: string) => {
    const r = reports.get(id);
    return r ? `the ${kindWords(r.kinds).toLowerCase()} report from ${formatShortDay(r.at)}` : "a report";
  };
  const groups: { day: string; rows: LogRow[] }[] = [];
  const push = (at: string, words: string, change: boolean) => {
    const d = formatDay(at);
    if (groups.at(-1)?.day !== d) groups.push({ day: d, rows: [] });
    groups.at(-1)!.rows.push({ at, words, change });
  };
  let reads = null as { at: string; minute: string; opened: string[]; profile: boolean } | null;
  const flush = () => {
    if (!reads) return;
    const dates = reads.opened.flatMap((id) => {
      const r = reports.get(id);
      return r ? [formatShortDay(r.at)] : [];
    });
    const parts = [
      ...(reads.profile ? [`${name}'s profile`] : []),
      ...(reads.opened.length === 1 ? [reportWords(reads.opened[0])] : reads.opened.length > 1 ? [`the reports from ${dates.join(" and ")}`] : []),
    ];
    push(reads.at, `Opened ${parts.join(" and ")}`, false);
    reads = null;
  };
  for (const r of receipts) {
    const [verb, id, status, ...rest] = r.what.split(" ");
    if (verb === "case" && id && status) {
      flush();
      const label = STATUSES.find((s) => s.id === status)?.label ?? status;
      push(r.at, `Moved ${reportWords(id)} to ${label}${rest.length ? ", with a note" : ""}`, true);
      continue;
    }
    const minute = formatDay(r.at) + formatTime(r.at);
    if (reads?.minute !== minute) {
      flush();
      reads = { at: r.at, minute, opened: [], profile: false };
    }
    if (verb === "alert" && id && !reads.opened.includes(id)) reads.opened.push(id);
    if (r.what === "student profile") reads.profile = true;
  }
  flush();
  return groups;
}

export const HOTLINES = [
  { name: "Childhelp National Child Abuse Hotline", number: "1-800-422-4453", tel: "+18004224453", detail: "Call or text, any time. Counselors connect you to the right local agency." },
  { name: "988 Suicide and Crisis Lifeline", number: "988", tel: "988", detail: "Call or text, any time, if she may hurt herself or is in crisis." },
  { name: "Emergency services", number: "911", tel: "911", detail: "If she's in danger right now." },
] as const;

export const mapUrl = (lat: number, lng: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
