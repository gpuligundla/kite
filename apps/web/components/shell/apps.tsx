import { KiteMark } from "@/components/kit/KiteMark";
import { Glyph, type GlyphName } from "@/components/os/Glyph";
import s from "./shell.module.css";

export type AppId =
  | "kite" | "classroom" | "assignments" | "quizzes" | "calendar" | "stories" | "creations" | "camera"
  | "call" | "messages" | "location";

/** Every app Kite OS has. There is no store, no browser and no feed: this list is the whole device. */
export const APPS: Record<AppId, { name: string; short?: string; glyph: GlyphName; tone: string }> = {
  kite: { name: "Kite", glyph: "sparkle", tone: "kite" },
  classroom: { name: "Classroom", glyph: "board", tone: "classroom" },
  assignments: { name: "To-do", glyph: "list", tone: "assignments" },
  quizzes: { name: "Quizzes & exams", short: "Quizzes", glyph: "timer", tone: "quizzes" },
  calendar: { name: "Calendar", glyph: "calendar", tone: "calendar" },
  stories: { name: "Story time", glyph: "book", tone: "stories" },
  creations: { name: "My creations", glyph: "star", tone: "creations" },
  camera: { name: "What's this?", short: "Camera", glyph: "camera", tone: "camera" },
  call: { name: "Call", glyph: "call", tone: "call" },
  messages: { name: "Messages", glyph: "message", tone: "messages" },
  location: { name: "Location", glyph: "pin", tone: "location" },
};

/** A squircle on its own gradient. Kite wears its kite; Calendar shows today's date, like a paper calendar. */
export function AppIcon({ id, size, now }: { id: AppId; size: number; now: Date | null }) {
  const app = APPS[id];
  return (
    <span className={s.icon} data-tone={app.tone} style={{ width: size, height: size }} aria-hidden="true">
      {id === "kite" ? (
        <KiteMark size={Math.round(size * 0.42)} />
      ) : id === "calendar" ? (
        <span className={s.calendarFace} style={{ fontSize: size * 0.4 }}>
          <span>{now?.toLocaleDateString(undefined, { weekday: "short" }) ?? ""}</span>
          {now?.getDate() ?? ""}
        </span>
      ) : (
        <Glyph name={app.glyph} size={Math.round(size * 0.46)} />
      )}
    </span>
  );
}
