"use client";

import { Glyph } from "@/components/os/Glyph";
import {
  byUrgency, clock, dayWord, KITE_WILL, STATUS_NAME, whenLabel, type Assignment, type Classroom, type Course,
} from "./classroom";
import s from "./shell.module.css";

interface SchoolProps {
  room: Classroom | null;
  /** The class couldn't be read and there's none on screen yet. */
  failed: boolean;
  now: Date | null;
  /** The assignment open inside this app, if any. */
  assignment: Assignment | null;
  onOpen: (a: Assignment, app?: "assignments" | "quizzes" | "calendar" | "classroom") => void;
  /** Open Ask Kite about the assignment on screen, optionally sending a question straight away. */
  onAsk: (text?: string) => void;
}

const courseOf = (room: Classroom, a: Assignment): Course | undefined => room.courses.find((c) => c.id === a.course_id);

function Loading({ room, failed }: { room: Classroom | null; failed?: boolean }) {
  if (!room && failed) return <p className={s.quietLine}>Kite couldn&apos;t open your class. Try again in a moment.</p>;
  return room ? null : <p className={s.quietLine}>Opening your class…</p>;
}

function StatusChip({ a }: { a: Assignment }) {
  return (
    <span className={s.status} data-status={a.status}>
      {a.status === "exam_live" && <Glyph name="lock" size={14} />}
      {STATUS_NAME[a.status]}
    </span>
  );
}

/** One assignment: what it asks, when it's due, and what Kite will do about it right now. */
export function AssignmentPage({ room, now, a, onAsk }: { room: Classroom; now: Date | null; a: Assignment; onAsk: (text?: string) => void }) {
  const course = courseOf(room, a);
  const live = a.status === "exam_live";
  return (
    <article className={s.assignment} data-status={a.status}>
      <header className={s.assignmentHead}>
        <p className={s.crumb}>
          <span className={s.courseDot} data-course={a.course_id} />
          <strong>{course?.name}</strong>
          <span>{course?.teacher}</span>
        </p>
        <h2 className={s.assignmentTitle}>{a.title}</h2>
        <div className={s.assignmentMeta}>
          <StatusChip a={a} />
          <span>{now ? whenLabel(a, now) : ""}</span>
        </div>
      </header>
      <aside className={s.kiteSide}>
        <div className={s.kiteNote} data-status={a.status}>
          <Glyph name={live ? "lock" : "sparkle"} size={22} />
          <div>
            <strong>{KITE_WILL[a.status]}</strong>
            <span>
              {live
                ? "Kite won't help with questions that could be on it until it's over. You've got this!"
                : a.status === "open"
                  ? "Kite gives hints and asks questions, so the answers stay yours."
                  : a.status === "closed"
                    ? "It's finished, so Kite can walk you through how each one works."
                    : "Kite can help once it opens."}
            </span>
          </div>
        </div>
        {a.status !== "upcoming" && (
          <button type="button" className={s.askBig} onClick={() => onAsk()}>
            <Glyph name="sparkle" size={22} />
            Ask Kite about this
          </button>
        )}
      </aside>
      <ol className={s.questionList} aria-label={a.kind === "quiz" ? "Quiz questions" : "Homework questions"}>
        {a.questions.map((q, i) => (
          <li key={q}>
            <span className={s.qNumber}>{i + 1}</span>
            <p>{q}</p>
            {a.status !== "upcoming" && (
              <button type="button" className={s.askSmall} onClick={() => onAsk(`Can you help me with question ${i + 1}? ${q}`)}>
                <Glyph name="sparkle" size={16} />
                Ask Kite
              </button>
            )}
          </li>
        ))}
      </ol>
    </article>
  );
}

function Row({ a, room, now, onOpen }: { a: Assignment; room: Classroom; now: Date | null; onOpen: () => void }) {
  return (
    <li>
      <button type="button" className={s.row} data-status={a.status} onClick={onOpen}>
        <span className={s.rowIcon} data-course={a.course_id}>
          <Glyph name={a.kind === "quiz" ? "timer" : "list"} size={20} />
        </span>
        <span className={s.rowText}>
          <strong>{a.title}</strong>
          <span className={s.rowMeta}>
            <span>{courseOf(room, a)?.name}</span>
            <span>{now ? whenLabel(a, now) : ""}</span>
          </span>
        </span>
        <StatusChip a={a} />
      </button>
    </li>
  );
}

/** Google Classroom's shape: class cards, then a class stream, then the assignment. */
export function ClassroomApp({ room, failed, now, assignment, onOpen, onAsk, course, onCourse }: SchoolProps & { course?: string; onCourse: (id: string) => void }) {
  if (!room) return <Loading room={room} failed={failed} />;
  if (assignment) return <AssignmentPage room={room} now={now} a={assignment} onAsk={onAsk} />;
  const open = room.courses.find((c) => c.id === course);
  if (open) {
    const work = room.assignments.filter((a) => a.course_id === open.id);
    const upcoming = byUrgency(work.filter((a) => a.status === "open" || a.status === "exam_live" || a.status === "upcoming"));
    const stream = [...work].sort((a, b) => Date.parse(b.unlock_at ?? "") - Date.parse(a.unlock_at ?? ""));
    return (
      <div className={s.course}>
        <header className={s.banner} data-course={open.id}>
          <h2>{open.name}</h2>
          <p>{open.teacher}</p>
        </header>
        <div className={s.courseBody}>
          <aside className={s.upcoming}>
            <h3>Upcoming</h3>
            {upcoming.length === 0 && <p className={s.quietLine}>Woohoo, no work due soon!</p>}
            {upcoming.map((a) => (
              <button key={a.id} type="button" className={s.upcomingItem} onClick={() => onOpen(a, "classroom")}>
                <span>{now ? whenLabel(a, now) : ""}</span>
                {a.title}
              </button>
            ))}
          </aside>
          <ul className={s.stream} aria-label={`${open.name} stream`}>
            {stream.map((a) => (
              <li key={a.id}>
                <button type="button" className={s.post} data-status={a.status} onClick={() => onOpen(a, "classroom")}>
                  <span className={s.rowIcon} data-course={a.course_id}>
                    <Glyph name={a.kind === "quiz" ? "timer" : "list"} size={20} />
                  </span>
                  <span className={s.rowText}>
                    <strong>
                      {open.teacher} posted a new {a.kind === "quiz" ? "quiz" : "assignment"}: {a.title}
                    </strong>
                    <span>{a.unlock_at && now ? `${dayWord(new Date(a.unlock_at), now)} at ${clock(new Date(a.unlock_at))}` : ""}</span>
                  </span>
                  <StatusChip a={a} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }
  return (
    <div className={s.classes}>
      {room.courses.map((c) => {
        const work = byUrgency(room.assignments.filter((a) => a.course_id === c.id && a.status !== "closed"));
        return (
          <button key={c.id} type="button" className={s.classCard} onClick={() => onCourse(c.id)}>
            <span className={s.classHead} data-course={c.id}>
              <strong>{c.name}</strong>
              <span>{c.teacher}</span>
            </span>
            <span className={s.classBody}>
              {work.length === 0 ? (
                <span className={s.quietLine}>Nothing due</span>
              ) : (
                work.slice(0, 2).map((a) => (
                  <span key={a.id} className={s.classDue} data-status={a.status}>
                    <strong>{a.title}</strong>
                    <span>{a.status === "exam_live" ? "Happening now" : now ? whenLabel(a, now) : ""}</span>
                  </span>
                ))
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Her to-do list: what's happening now, what's due, what's coming, and what's finished. */
export function AssignmentsApp({ room, failed, now, assignment, onOpen, onAsk }: SchoolProps) {
  if (!room) return <Loading room={room} failed={failed} />;
  if (assignment) return <AssignmentPage room={room} now={now} a={assignment} onAsk={onAsk} />;
  const groups: [string, Assignment[]][] = [
    ["Happening now", room.assignments.filter((a) => a.status === "exam_live")],
    ["To do", byUrgency(room.assignments.filter((a) => a.status === "open"))],
    ["Coming up", byUrgency(room.assignments.filter((a) => a.status === "upcoming"))],
    ["Finished", room.assignments.filter((a) => a.status === "closed")],
  ];
  return (
    <div className={s.list}>
      {groups
        .filter(([, list]) => list.length > 0)
        .map(([title, list]) => (
          <section key={title} className={s.group}>
            <h3>{title}</h3>
            <ul>
              {list.map((a) => (
                <Row key={a.id} a={a} room={room} now={now} onOpen={() => onOpen(a, "assignments")} />
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}

/** Quizzes: a live one leads, big, with Kite paused for it. */
export function QuizzesApp({ room, failed, now, assignment, onOpen, onAsk }: SchoolProps) {
  if (!room) return <Loading room={room} failed={failed} />;
  if (assignment) return <AssignmentPage room={room} now={now} a={assignment} onAsk={onAsk} />;
  const quizzes = byUrgency(room.assignments.filter((a) => a.kind === "quiz"));
  const live = quizzes.filter((a) => a.status === "exam_live");
  const rest = quizzes.filter((a) => a.status !== "exam_live");
  return (
    <div className={s.list}>
      {live.map((a) => (
        <button key={a.id} type="button" className={s.liveQuiz} onClick={() => onOpen(a, "quizzes")}>
          <span className={s.liveTag}>
            <i />
            Happening now
          </span>
          <strong>{a.title}</strong>
          <span className={s.livePause}>
            <Glyph name="lock" size={18} />
            Kite is paused for this quiz
          </span>
          <span className={s.liveWhen}>
            <span>{courseOf(room, a)?.name}</span>
            <span>{a.questions.length} questions</span>
            {a.lock_at && now && <span>Ends {dayWord(new Date(a.lock_at), now)}</span>}
          </span>
        </button>
      ))}
      {rest.length > 0 && (
        <section className={s.group}>
          <h3>Other quizzes</h3>
          <ul>
            {rest.map((a) => (
              <Row key={a.id} a={a} room={room} now={now} onOpen={() => onOpen(a, "quizzes")} />
            ))}
          </ul>
        </section>
      )}
      {quizzes.length === 0 && <p className={s.quietLine}>No quizzes yet.</p>}
    </div>
  );
}

const DAY_MS = 86_400_000;

/** Two weeks from this Sunday, with each due date on its day. */
export function CalendarApp({ room, failed, now, assignment, onOpen, onAsk }: SchoolProps) {
  if (!room || !now) return <Loading room={room} failed={failed} />;
  if (assignment) return <AssignmentPage room={room} now={now} a={assignment} onAsk={onAsk} />;
  const sunday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
  const days = Array.from({ length: 14 }, (_, i) => new Date(sunday.getTime() + i * DAY_MS + 3_600_000 * 2));
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const dueOn = (d: Date) => room.assignments.filter((a) => a.due_at && sameDay(new Date(a.due_at), d));
  return (
    <div className={s.calendar}>
      <h2 className={s.month}>{now.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h2>
      <div className={s.weekdays} aria-hidden="true">
        {days.slice(0, 7).map((d) => (
          <span key={d.toISOString()}>{d.toLocaleDateString(undefined, { weekday: "short" })}</span>
        ))}
      </div>
      <ol className={s.days}>
        {days.map((d) => (
          <li key={d.toISOString()} className={s.day} data-today={sameDay(d, now)} data-past={d < now && !sameDay(d, now)}>
            <span className={s.dayNumber}>{d.getDate() === 1 ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : d.getDate()}</span>
            {dueOn(d).map((a) => (
              <button key={a.id} type="button" className={s.dayItem} data-status={a.status} onClick={() => onOpen(a, "calendar")}>
                <strong>{a.title}</strong>
                <span>{clock(new Date(a.due_at!))}</span>
              </button>
            ))}
          </li>
        ))}
      </ol>
    </div>
  );
}
