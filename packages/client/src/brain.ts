import type { components } from "./contract.d.ts";
import { buildTurnForm, type DeviceKind, type Grade, type SayInput } from "./form.ts";
import {
  NO_TURN, emptyTalk, reduceTalk, setClaim, takeClip,
  type Clip, type KiteEvent, type TalkState, type TurnId,
} from "./talk.ts";

export type { Attachment, DeviceKind, Grade, SayInput } from "./form.ts";
export type { Clip, KiteEvent, Sentence, TalkState, TurnDone, TurnId, TurnKey, TurnView } from "./talk.ts";
export { NO_TURN } from "./talk.ts";

export type Teachable = components["schemas"]["Teachable"];
export type DashboardView = components["schemas"]["DashboardView"];

/**
 * What both browser EventSource and react-native-sse satisfy. `withCredentials` is in the init type only so that
 * lib.dom's EventSource stays assignable: without it tsc rejects the assignment as a weak type.
 */
export interface SseSource {
  addEventListener(type: string, listener: (e: { data?: string | null; xhrStatus?: number }) => void): void;
  close(): void;
  /** 2 is CLOSED. Browsers set it; react-native-sse may not, and retries on its own. */
  readonly readyState?: number;
}

const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 10000;
export type SseCtor = new (url: string, init?: { headers?: Record<string, string>; withCredentials?: boolean }) => SseSource;

type Common = {
  /** "/brain" behind the Next proxy, a full origin from the phone. */
  baseUrl: string;
  /** The brain has no whoami, and a device token belongs to exactly one kid. */
  kidId: string;
  device: DeviceKind;
  /** `status` is set only when the SSE library exposes it (react-native-sse does). */
  onStreamError?: (e: { status?: number }) => void;
};

export type BrainConfig = Common &
  (
    | { auth: { kind: "cookie" }; EventSourceImpl?: SseCtor }
    // A browser EventSource cannot send an Authorization header, so bearer must bring its own.
    | { auth: { kind: "bearer"; token: string }; EventSourceImpl: SseCtor }
  );

/** `detail` flattens FastAPI's two shapes, a string and a list of field errors. `status` is 0 when the request never got a response. */
export class BrainError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(detail);
    this.name = "BrainError";
    this.status = status;
    this.detail = detail;
  }
}

export interface Talk {
  /** Stable between changes, so it works as a useSyncExternalStore snapshot. */
  getState(): TalkState;
  /** The first subscriber of either kind opens the SSE stream and the last one closes it. */
  subscribe(onChange: () => void): () => void;
  /** Undefined when nothing is waiting. Subscribers hear about the change on the next microtask, never inside this call. */
  next(): Clip | undefined;
}

export interface Brain {
  readonly talk: Talk;
  /** Resolves with the turn id once the brain accepted the turn and this device claimed it. */
  say(input: SayInput): Promise<TurnId>;
  /** Raw contract events, snake_case as generated, for what is not talk: alerts, cards, creations. Shares the stream. */
  subscribe(onEvent: (e: KiteEvent) => void): () => void;
  teachable(): Promise<Teachable[]>;
  /** The opening line arrives as a clip with no turn, usually before this resolves. */
  startTeach(conceptId: string): Promise<void>;
  sos(at: { lat: number; lng: number }): Promise<void>;
  /** Resolves with the creation id. Progress arrives as creation.* events. */
  makeGame(topic: string, learningGoal: string): Promise<string>;
  /** The brain serves game.html at its root, so a game behind the /brain proxy needs the prefix. */
  gameUrl(creationId: string): string;
  /** Parent devices only. */
  dashboard(grade?: Grade): Promise<DashboardView>;
  /** Any other route, with this device's auth. Paths start at the brain's root, e.g. `/kids/maya/contacts`. */
  get<T>(path: string): Promise<T>;
  post<T>(path: string, json?: unknown): Promise<T>;
  put<T>(path: string, json: unknown): Promise<T>;
}

export function createBrain(config: BrainConfig): Brain {
  const who = { kidId: config.kidId, device: config.device };
  const kid = `/kids/${encodeURIComponent(config.kidId)}`;
  let state = emptyTalk;
  const talkWatchers = new Set<() => void>();
  const eventWatchers = new Set<(e: KiteEvent) => void>();
  let closeStream: (() => void) | undefined;
  let queued = false;

  // One notification per microtask burst. A pump that calls next() must not be re-entered by its own subscription.
  const notify = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      for (const w of talkWatchers) w();
    });
  };
  const commit = (next: TalkState) => {
    if (next === state) return;
    state = next;
    notify();
  };
  const deliver = (e: KiteEvent) => {
    commit(reduceTalk(state, e));
    for (const w of eventWatchers) w(e);
  };
  const watch = <W>(watchers: Set<W>, w: W): (() => void) => {
    closeStream ??= openStream(config, `${kid}/events`, deliver);
    watchers.add(w);
    return () => {
      if (watchers.delete(w) && talkWatchers.size + eventWatchers.size === 0) {
        closeStream?.();
        closeStream = undefined;
      }
    };
  };

  return {
    talk: {
      getState: () => state,
      subscribe: (onChange) => watch(talkWatchers, onChange),
      next() {
        const [next, clip] = takeClip(state);
        commit(next);
        return clip;
      },
    },
    async say(input) {
      const { turn_id } = await request<{ turn_id: string }>(config, "POST", "/turns", { form: buildTurnForm(who, input) });
      const id = turn_id as TurnId;
      commit(setClaim(state, id, true));
      return id;
    },
    subscribe: (onEvent) => watch(eventWatchers, onEvent),
    teachable: () => request<Teachable[]>(config, "GET", `${kid}/teachable`),
    async startTeach(conceptId) {
      // The opener is published before the response returns, so the claim has to exist first.
      commit(setClaim(state, NO_TURN, true));
      try {
        await request(config, "POST", `${kid}/teach/start`, { json: { concept_id: conceptId } });
      } catch (err) {
        commit(setClaim(state, NO_TURN, false));
        throw err;
      }
    },
    async sos(at) {
      await request(config, "POST", `${kid}/sos`, { json: at });
    },
    async makeGame(topic, learningGoal) {
      const { creation_id } = await request<{ creation_id: string }>(config, "POST", `${kid}/games/custom`, {
        json: { topic, learning_goal: learningGoal },
      });
      return creation_id;
    },
    gameUrl: (creationId) => endpoint(config, `/creations/${creationId}/game.html`),
    // 0 is K, so test for undefined rather than truthiness.
    dashboard: (grade) => request<DashboardView>(config, "GET", `${kid}/dashboard${grade === undefined ? "" : `?grade=${grade}`}`),
    get: (path) => request(config, "GET", path),
    post: (path, json) => request(config, "POST", path, { json }),
    put: (path, json) => request(config, "PUT", path, { json }),
  };
}

const endpoint = (config: BrainConfig, path: string) => config.baseUrl.replace(/\/$/, "") + path;

const authHeaders = (config: BrainConfig): Record<string, string> =>
  config.auth.kind === "bearer" ? { Authorization: `Bearer ${config.auth.token}` } : {};

/** The one fetch. Never reads the query string for auth, and never sets Content-Type on a FormData, which needs its boundary. */
async function request<T>(
  config: BrainConfig,
  method: "GET" | "POST" | "PUT",
  path: string,
  body: { json?: unknown; form?: FormData } = {},
): Promise<T> {
  const headers = authHeaders(config);
  if (body.json !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(endpoint(config, path), {
      method,
      headers,
      body: body.form ?? (body.json === undefined ? undefined : JSON.stringify(body.json)),
    });
  } catch (err) {
    throw new BrainError(0, err instanceof Error ? err.message : String(err));
  }
  if (!res.ok) throw await failure(res);
  return (await res.json()) as T;
}

async function failure(res: Response): Promise<BrainError> {
  const body: { detail?: unknown } | null = await res.json().catch(() => null);
  const detail = body?.detail;
  if (typeof detail === "string") return new BrainError(res.status, detail);
  if (Array.isArray(detail)) {
    const lines = detail.map((d: { loc?: unknown[]; msg?: string }) => `${d.loc?.join(".") ?? "body"}: ${d.msg ?? "invalid"}`);
    return new BrainError(res.status, lines.join("; "));
  }
  return new BrainError(res.status, res.statusText || `HTTP ${res.status}`);
}

/** A missing or extra key fails typecheck when contract.d.ts gains or loses an event type. */
const EVENT_TYPES: Record<KiteEvent["type"], true> = {
  heard: true, decided: true, recalled: true, routed: true, "answer.sentence": true, "answer.done": true,
  taught: true, "memory.saved": true, alert: true, card: true,
  "creation.progress": true, "creation.ready": true, "creation.video": true,
};

/**
 * Frames are named, so onmessage never fires and every type needs its own listener. Reconnect and Last-Event-ID
 * belong to the EventSource implementation. Events are not filtered by id here (see reduceTalk).
 */
function openStream(config: BrainConfig, path: string, deliver: (e: KiteEvent) => void): () => void {
  const Source: SseCtor | undefined = config.EventSourceImpl ?? globalThis.EventSource;
  if (!Source) throw new Error("No EventSource here: pass EventSourceImpl (Node, React Native) or run in a browser");
  let es: SseSource | undefined;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let delay = RETRY_MIN_MS;
  const connect = () => {
    const source = new Source(endpoint(config, path), config.auth.kind === "bearer" ? { headers: authHeaders(config) } : undefined);
    es = source;
    for (const name of Object.keys(EVENT_TYPES)) {
      source.addEventListener(name, (m) => {
        delay = RETRY_MIN_MS;
        const e = parseFrame(name, m.data);
        if (e) deliver(e);
      });
    }
    source.addEventListener("error", (m) => {
      config.onStreamError?.({ status: m.xhrStatus });
      // A browser EventSource retries a dropped connection itself but gives up for good on an HTTP error status,
      // which a brain restart behind the proxy produces. Open a fresh one, backing off up to 10 s.
      if (source.readyState === 2 && !stopped) {
        source.close();
        retry = setTimeout(connect, delay);
        delay = Math.min(delay * 2, RETRY_MAX_MS);
      }
    });
  };
  connect();
  return () => {
    stopped = true;
    clearTimeout(retry);
    es?.close();
  };
}

/** The boundary where wire JSON becomes a KiteEvent. A malformed frame is dropped, not thrown. */
function parseFrame(name: string, data: string | null | undefined): KiteEvent | undefined {
  try {
    const frame: unknown = JSON.parse(data ?? "");
    return typeof frame === "object" && frame !== null && (frame as { type?: unknown }).type === name ? (frame as KiteEvent) : undefined;
  } catch {
    return undefined;
  }
}
