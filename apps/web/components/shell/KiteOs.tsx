"use client";

import { BrainError, type DeviceKind } from "@kite/client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { KiteMark } from "@/components/kit/KiteMark";
import { Glyph } from "@/components/os/Glyph";
import { KiteApp, type KiteRequest, type Surface } from "@/components/os/KiteApp";
import { SosButton } from "@/components/os/SosButton";
import { bandFor } from "@/lib/band";
import { KID_ID, useBrain, useBrainEvents } from "@/lib/brain";
import { isMuted, setMuted } from "@/lib/sound";
import { APPS, AppIcon, type AppId } from "./apps";
import { byUrgency, clock, whenLabel, type Assignment, type Classroom, type Contact, type MadeThing } from "./classroom";
import { CreationsApp } from "./CreationsApp";
import { CallApp, LocationApp, MessagesApp } from "./PhoneApps";
import { AssignmentsApp, CalendarApp, ClassroomApp, QuizzesApp } from "./SchoolApps";
import { Window } from "./Window";
import s from "./shell.module.css";

type Me = { name: string; grade: number };
// Kite OS opens as a third grader, and every reload comes back here. Below her real grade a turn is time travel:
// Kite answers as of that grade and saves nothing. The slider stops at her real grade, so no turn is ever stamped
// with a grade she hasn't reached.
const DEFAULT_GRADE = 3;
/** The app on screen, and where inside it. Kite itself isn't here: it's always mounted (see KiteApp's Surface). */
export type Screen =
  | { app: "home" }
  | { app: "classroom"; course?: string; assignment?: string }
  | { app: "assignments" | "quizzes" | "calendar"; assignment?: string }
  | { app: "creations"; open?: MadeThing }
  | { app: "call" | "messages"; contact?: string }
  | { app: "location" };
type KiteShown = "closed" | "window" | "panel";

const DESK: AppId[] = ["kite", "classroom", "assignments", "quizzes", "calendar", "stories", "creations", "camera"];
const SHELF_LEFT: AppId[] = ["kite", "classroom", "assignments", "quizzes"];
const SHELF_RIGHT: AppId[] = ["calendar", "stories", "creations", "camera"];
const PHONE_ROW: AppId[] = ["classroom", "creations", "location"];
const GRADE_NAME = (g: number) => (g === 0 ? "K" : String(g));

function useNow(): Date | null {
  // Null on the server and the first client render, so the clock never mismatches on hydration.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const tick = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(tick);
  }, []);
  return now;
}
const hello = (now: Date | null, name: string) => {
  const h = now?.getHours() ?? 12;
  return `${h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"}, ${name}`;
};

/**
 * Kite OS: the kid's school Chromebook shell, or (device=handheld) her kid-safe phone. School apps around Kite, and
 * Kite everywhere: the diamond in the dock talks to Kite from any screen and opens the Ask Kite panel over the app.
 */
export function KiteOs({ device }: { device: DeviceKind }) {
  const brain = useBrain(device);
  const now = useNow();
  const [me, setMe] = useState<Me | null>(null);
  const [blocked, setBlocked] = useState<"unpaired" | "offline" | null>(null);
  const [grade, setGrade] = useState(DEFAULT_GRADE);
  const [muted, setMutedState] = useState(false);
  const [screen, setScreen] = useState<Screen>({ app: "home" });
  const [kite, setKite] = useState<KiteShown>("closed");
  const [request, setRequest] = useState<KiteRequest | null>(null);
  const [room, setRoom] = useState<Classroom | null>(null);
  const [roomFailed, setRoomFailed] = useState(false);
  const [made, setMade] = useState<MadeThing[] | null>(null);
  const [people, setPeople] = useState<Contact[]>([]);
  const [fieldTrip, setFieldTrip] = useState(false);
  const band = bandFor(grade);
  const phone = device === "handheld";

  useEffect(() => {
    brain.get<Me>(`/kids/${KID_ID}/me`).then(
      (m) => setMe(m),
      (err) => setBlocked(err instanceof BrainError && (err.status === 401 || err.status === 403) ? "unpaired" : "offline"),
    );
  }, [brain]);
  // Read after mount: the server render can't see this browser's setting.
  useEffect(() => setMutedState(isMuted()), []);

  const loadRoom = useCallback(
    () =>
      brain.get<Classroom>(`/kids/${KID_ID}/classroom`).then(
        (r) => {
          setRoom(r);
          setRoomFailed(false);
        },
        () => setRoomFailed(true),
      ),
    [brain],
  );
  const loadMade = useCallback(() => brain.get<MadeThing[]>(`/kids/${KID_ID}/creations`).then(setMade, () => setMade((m) => m ?? [])), [brain]);
  useEffect(() => {
    void loadRoom();
    void loadMade();
    if (phone) brain.get<Contact[]>(`/kids/${KID_ID}/approved-contacts`).then(setPeople, () => {});
    // A live quiz ends on the clock, so the class is read again every minute.
    const tick = setInterval(() => void loadRoom(), 60_000);
    return () => clearInterval(tick);
  }, [brain, loadRoom, loadMade, phone]);
  useBrainEvents(brain, (e) => {
    if (e.type === "creation.ready") void loadMade();
  });

  const ask = (to: KiteRequest["to"], text?: string) => setRequest((r) => ({ n: (r?.n ?? 0) + 1, to, text }));
  const launch = (id: AppId) => {
    if (id === "kite") setKite("window");
    else if (id === "stories") {
      setKite("window");
      ask("story");
    } else if (id === "camera") ask("camera");
    else {
      setKite("closed");
      setScreen({ app: id } as Screen);
      if (id === "creations") void loadMade();
      else if (id !== "call" && id !== "messages" && id !== "location") void loadRoom();
    }
  };
  const home = () => {
    setKite("closed");
    setScreen({ app: "home" });
  };
  type Opens = "assignments" | "quizzes" | "calendar" | "classroom";
  const openAssignment = (a: Assignment, app: Opens = a.kind === "quiz" ? "quizzes" : "assignments") => {
    setKite("closed");
    setScreen(app === "classroom" ? { app, course: a.course_id, assignment: a.id } : { app, assignment: a.id });
  };

  const assignmentId = "assignment" in screen ? screen.assignment : undefined;
  const about = (assignmentId && room?.assignments.find((a) => a.id === assignmentId)) || null;
  const askAbout = (text?: string) => {
    setKite("panel");
    if (text) ask("talk", text);
  };

  if (blocked) {
    return (
      <main className={`kid ${s.unpaired}`} data-band="g35">
        <KiteMark size={96} />
        {blocked === "unpaired" ? (
          <>
            <h1>This screen isn&apos;t paired with Kite yet.</h1>
            <p>Open the setup link a grown-up made for this device, and Kite will be here.</p>
          </>
        ) : (
          <>
            <h1>Kite can&apos;t connect right now.</h1>
            <p>Check that this device is online, then reload the page.</p>
          </>
        )}
      </main>
    );
  }

  const surface: Surface = kite === "window" ? "window" : kite === "panel" ? "panel" : phone && screen.app === "home" ? "phone" : "bar";
  const openApp = kite === "window" ? "kite" : screen.app;
  const dockIcon = (id: AppId) => (
    <button
      key={id}
      type="button"
      className={s.dockIcon}
      data-open={openApp === id}
      onClick={() => launch(id)}
      aria-label={APPS[id].name}
      title={APPS[id].name}
    >
      <AppIcon id={id} size={phone ? 48 : 44} now={now} />
      {phone && <span className={s.dockLabel}>{APPS[id].short ?? APPS[id].name}</span>}
    </button>
  );
  const homeButton = (
    <button type="button" className={s.dockHome} onClick={home} aria-label="Home" title="Home" data-open={openApp === "home"}>
      <Glyph name="home" size={22} />
    </button>
  );
  const sides: { left: ReactNode; right: ReactNode } = phone
    ? surface === "phone"
      ? { left: <>{dockIcon("call")}{dockIcon("messages")}</>, right: <>{dockIcon("camera")}{dockIcon("kite")}</> }
      : { left: homeButton, right: dockIcon("camera") }
    : { left: <>{homeButton}{SHELF_LEFT.map(dockIcon)}</>, right: <>{SHELF_RIGHT.map(dockIcon)}</> };

  const shared = { room, failed: roomFailed, now, onOpen: openAssignment, onAsk: askAbout } as const;
  const appWindow = (() => {
    if (kite === "window" || screen.app === "home") return null;
    const meta = APPS[screen.app];
    const frame = (children: ReactNode, back: () => void, title = meta.name) => (
      <Window title={title} tone={meta.tone} icon={<Glyph name={meta.glyph} size={18} />} onBack={back} onClose={home} key={screen.app}>
        {children}
      </Window>
    );
    const up = () => setScreen({ app: screen.app } as Screen);
    switch (screen.app) {
      case "classroom":
        return frame(
          <ClassroomApp {...shared} course={screen.course} assignment={about} onCourse={(course) => setScreen({ app: "classroom", course })} />,
          screen.assignment ? () => setScreen({ app: "classroom", course: screen.course }) : screen.course ? up : home,
        );
      case "assignments":
        return frame(<AssignmentsApp {...shared} assignment={about} />, screen.assignment ? up : home);
      case "quizzes":
        return frame(<QuizzesApp {...shared} assignment={about} />, screen.assignment ? up : home);
      case "calendar":
        return frame(<CalendarApp {...shared} assignment={about} />, screen.assignment ? up : home);
      case "creations":
        return frame(
          <CreationsApp brain={brain} made={made} open={screen.open ?? null} onOpen={(open) => setScreen({ app: "creations", open })} />,
          screen.open ? up : home,
          phone ? "Stories & movies" : meta.name,
        );
      case "call":
        return frame(<CallApp people={people} calling={screen.contact} onCall={(contact) => setScreen({ app: "call", contact })} onHangUp={up} />, screen.contact ? up : home);
      case "messages":
        return frame(<MessagesApp people={people} with={screen.contact} onOpen={(contact) => setScreen({ app: "messages", contact })} />, screen.contact ? up : home);
      case "location":
        return frame(<LocationApp people={people} fieldTrip={fieldTrip} onFieldTrip={setFieldTrip} />, home);
    }
  })();

  const live = room?.assignments.find((a) => a.status === "exam_live");
  const next = room && byUrgency(room.assignments.filter((a) => a.status === "open"))[0];
  const newest = made?.[0];
  const name = me?.name ?? "";

  return (
    <main className={`kid ${s.os}`} data-band={band} data-device={device} data-ready={me !== null} data-kite={kite}>
      {phone ? (
        <header className={s.phoneStatus}>
          <span className={s.phoneTime}>{now ? clock(now).replace(/\s?[AP]M$/i, "") : ""}</span>
          <SosButton brain={brain} compact />
          <span className={s.phoneIcons} aria-hidden="true">
            <svg width="18" height="12" viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1" fill="currentColor" /><rect x="5" y="5" width="3" height="7" rx="1" fill="currentColor" /><rect x="10" y="2.5" width="3" height="9.5" rx="1" fill="currentColor" /><rect x="15" y="0" width="3" height="12" rx="1" fill="currentColor" /></svg>
            <Glyph name="wifi" size={17} />
            <span className={s.battery}><i style={{ width: "78%" }} /></span>
          </span>
        </header>
      ) : (
        <header className={s.statusBar}>
          <span className={s.brand}>
            <KiteMark size={20} />
            Kite OS
          </span>
          <span className={s.when}>
            {now && (
              <>
                {now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                <strong>{clock(now)}</strong>
              </>
            )}
          </span>
          <span className={s.tray}>
            <label className={s.grade}>
              <span>Grade {GRADE_NAME(grade)}</span>
              <input
                type="range"
                min={0}
                max={me?.grade ?? 12}
                step={1}
                value={grade}
                onChange={(e) => setGrade(Number(e.target.value))}
                aria-valuetext={`Grade ${GRADE_NAME(grade)}`}
              />
            </label>
            <button
              type="button"
              className={s.trayButton}
              aria-pressed={muted}
              aria-label={muted ? "Turn sound on" : "Turn sound off"}
              onClick={() => {
                setMuted(!muted);
                setMutedState(!muted);
              }}
            >
              <Glyph name={muted ? "soundOff" : "soundOn"} size={20} />
            </button>
            <Glyph name="wifi" size={18} />
            <span className={s.battery} aria-label="Battery 78%"><i style={{ width: "78%" }} /></span>
            <span className={s.avatar} title={name}>{name.slice(0, 1)}</span>
          </span>
        </header>
      )}

      {screen.app === "home" && kite !== "window" && (
        phone ? (
          <section className={s.phoneHome} aria-label="Home">
            <div className={s.lock}>
              <p className={s.lockDate}>{now?.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
              <p className={s.lockTime}>{now ? clock(now).replace(/\s?[AP]M$/i, "") : " "}</p>
              <p className={s.lockHello}>{name ? `Hi ${name}` : " "}</p>
            </div>
            <div className={s.widgets}>
              <button type="button" className={s.widget} data-tone={live ? "live" : "class"} onClick={() => (live ? openAssignment(live, "classroom") : launch("classroom"))}>
                <span className={s.widgetHead}><Glyph name="board" size={16} />{live ? "Happening now" : "Next up"}</span>
                <strong>{live?.title ?? next?.title ?? "Nothing due"}</strong>
                <span className={s.widgetNote}>{live ? "Kite is paused for this quiz" : next && now ? whenLabel(next, now) : "You're all caught up"}</span>
              </button>
              <button type="button" className={s.widget} data-tone={fieldTrip ? "trip" : "where"} onClick={() => launch("location")}>
                <span className={s.widgetHead}><Glyph name={fieldTrip ? "bus" : "pin"} size={16} />{fieldTrip ? "Field trip" : "Location"}</span>
                <strong>{fieldTrip ? "Field trip mode is on" : "Shared with family"}</strong>
                <span className={s.widgetNote}>{fieldTrip ? "Stay with your group" : people.map((p) => p.name.split(" ")[0]).join(" and ") || "Your grown-ups"} can see where you are</span>
              </button>
            </div>
            <div className={s.peopleWidget}>
              <span className={s.widgetHead}><Glyph name="people" size={16} />Your people</span>
              <ul>
                {people.map((p) => (
                  <li key={p.id}>
                    <span className={s.face} aria-hidden="true">{p.name.slice(0, 1)}</span>
                    <span className={s.faceName}>{p.name.split(" ")[0]}</span>
                    <button type="button" className={s.faceAction} onClick={() => setScreen({ app: "call", contact: p.id })} aria-label={`Call ${p.name}`}>
                      <Glyph name="call" size={18} />
                    </button>
                    <button type="button" className={s.faceAction} onClick={() => setScreen({ app: "messages", contact: p.id })} aria-label={`Text ${p.name}`}>
                      <Glyph name="message" size={18} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <nav className={s.phoneApps} aria-label="Apps">
              {PHONE_ROW.map((id) => (
                <button key={id} type="button" className={s.launch} onClick={() => launch(id)}>
                  <AppIcon id={id} size={60} now={now} />
                  <span>{id === "creations" ? "Stories & movies" : APPS[id].name}</span>
                </button>
              ))}
            </nav>
          </section>
        ) : (
          <section className={s.desk} aria-label="Home">
            <div className={s.deskMain}>
              <div className={s.hero}>
                <p className={s.bigClock}>{now ? clock(now).replace(/\s?[AP]M$/i, "") : " "}</p>
                <p className={s.greeting}>{name ? hello(now, name) : " "}</p>
              </div>
              <nav className={s.launcher} aria-label="Apps">
                {DESK.map((id) => (
                  <button key={id} type="button" className={s.launch} onClick={() => launch(id)}>
                    <AppIcon id={id} size={band === "k2" ? 92 : band === "g912" ? 72 : 82} now={now} />
                    <span>{APPS[id].name}</span>
                  </button>
                ))}
              </nav>
            </div>
            <aside className={s.today} aria-label="Today">
              <h2 className={s.todayTitle}>
                <Glyph name="sparkle" size={20} />
                Today
              </h2>
              {live && (
                <button type="button" className={s.todayItem} data-tone="live" onClick={() => openAssignment(live)}>
                  <span className={s.todayKind}><Glyph name="lock" size={16} />Quiz happening now</span>
                  <strong>{live.title}</strong>
                  <span>Kite is paused for this quiz. You&apos;ve got this!</span>
                </button>
              )}
              {next && (
                <button type="button" className={s.todayItem} data-tone="due" onClick={() => openAssignment(next)}>
                  <span className={s.todayKind}><Glyph name="list" size={16} />Next due</span>
                  <strong>{next.title}</strong>
                  <span>{now ? whenLabel(next, now) : ""}. Kite can give you hints.</span>
                </button>
              )}
              {newest && (
                <button type="button" className={s.todayItem} data-tone="made" onClick={() => { setKite("closed"); setScreen({ app: "creations", open: newest }); }}>
                  <span className={s.todayKind}><Glyph name={newest.kind === "story" ? "book" : newest.kind} size={16} />Ready for you</span>
                  <strong>{newest.title}</strong>
                  <span>Your {newest.kind} is ready to {newest.kind === "story" ? "read" : newest.kind === "game" ? "play" : "watch"}.</span>
                </button>
              )}
              {room && !live && !next && <p className={s.todayEmpty}>Nothing due. Ask Kite about anything you wonder.</p>}
            </aside>
          </section>
        )
      )}

      {appWindow}

      {kite === "panel" && <div className={s.scrim} aria-hidden="true" onClick={() => setKite("closed")} />}
      <KiteApp
        brain={brain}
        device={device}
        name={me?.name ?? null}
        grade={grade}
        muted={muted}
        surface={surface}
        about={about}
        request={request}
        onShow={(show) => setKite(show)}
        sides={sides}
      />
    </main>
  );
}
