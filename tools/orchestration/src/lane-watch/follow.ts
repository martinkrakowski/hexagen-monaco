import {
  EXIT_ERROR,
  EXIT_INTERRUPTED,
  EXIT_OK,
  EXIT_STALL,
  errorText,
} from "./errors.js";
import { FrameTooLargeError, readFrames } from "./sse.js";

export interface FollowDeps {
  /** The one request helper (`makeGet`). */
  readonly get: (pathname: string) => Promise<Response>;
  /** Aborted by this function on every exit path, and by the stall timer. */
  readonly controller: AbortController;
  /** Aborted from outside (a signal handler). */
  readonly external?: AbortSignal;
  readonly session: string;
  readonly stallMs: number;
  readonly log: (text: string) => void;
  readonly logError: (text: string) => void;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A server-supplied word, made safe to print on a terminal. */
function printable(value: unknown): string {
  const text = typeof value === "string" ? value : "?";
  let safe = "";
  for (const char of text.slice(0, 80)) {
    const code = char.codePointAt(0) ?? 0;
    const control =
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x2028 ||
      code === 0x2029;
    safe += control ? "?" : char;
  }
  return safe;
}

/** The session a frame belongs to: its own `sessionID`, or its part's. */
function sessionOf(properties: Json): string | undefined {
  if (typeof properties.sessionID === "string") return properties.sessionID;
  const part = properties.part;
  if (isObject(part) && typeof part.sessionID === "string")
    return part.sessionID;
  return undefined;
}

/** What a frame for our session means. `undefined` says nothing worth printing. */
function describe(
  type: string,
  properties: Json,
): string | { done: true } | undefined {
  if (type === "session.idle") return { done: true };
  if (type === "session.status") {
    const status = properties.status;
    const kind = isObject(status) ? status.type : undefined;
    if (kind === "idle") return { done: true };
    return typeof kind === "string" ? `status ${printable(kind)}` : undefined;
  }
  if (type === "message.part.updated") {
    const part = properties.part;
    if (!isObject(part)) return undefined;
    if (part.type === "step-start") return "step start";
    if (part.type === "step-finish") return "step finish";
    if (part.type === "tool") {
      const state = isObject(part.state) ? part.state.status : undefined;
      return `tool ${printable(part.tool)} ${printable(state)}`;
    }
  }
  // `message.part.delta` is token-by-token text and not progress.
  return undefined;
}

/**
 * Follow one session until it is done.
 *
 * The stall timer is the heart of it: it measures silence FROM THIS SESSION, so
 * it is reset only by a frame that belongs to it. `server.heartbeat` frames and
 * other sessions' events arrive whether or not the lane is alive and must not
 * count. It is armed BEFORE the connection is attempted, so a connect that never
 * answers is a stall like any other, and it is a single timer replaced in place,
 * not a list that grows with the length of the watch.
 */
export async function follow(deps: FollowDeps): Promise<number> {
  const { controller, session } = deps;
  let stalled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      stalled = true;
      controller.abort();
    }, deps.stallMs);
  };
  const interrupted = (): boolean => deps.external?.aborted === true;
  const onExternal = (): void => controller.abort();
  deps.external?.addEventListener("abort", onExternal, { once: true });

  try {
    if (interrupted()) return EXIT_INTERRUPTED;
    arm();
    let lastLine: string | undefined;
    try {
      const response = await deps.get("/global/event");
      if (!response.ok || response.body === null) {
        deps.logError(
          `lane-watch: the event stream answered HTTP ${response.status}`,
        );
        return EXIT_ERROR;
      }
      for await (const data of readFrames(response.body)) {
        let envelope: unknown;
        try {
          envelope = JSON.parse(data);
        } catch {
          continue;
        }
        const payload = isObject(envelope) ? envelope.payload : undefined;
        if (!isObject(payload) || typeof payload.type !== "string") continue;
        const properties = isObject(payload.properties)
          ? payload.properties
          : {};
        if (sessionOf(properties) !== session) continue;
        arm();
        const meaning = describe(payload.type, properties);
        if (typeof meaning === "object") {
          // The concluding frame: leave NOW, before anything else is read.
          deps.log("done");
          return EXIT_OK;
        }
        if (meaning !== undefined && meaning !== lastLine) {
          lastLine = meaning;
          deps.log(meaning);
        }
      }
      deps.logError(
        "lane-watch: the event stream ended before the session went idle",
      );
      return EXIT_ERROR;
    } catch (error: unknown) {
      if (stalled) {
        deps.logError(
          `lane-watch: stalled: no event for session ${session} in ${deps.stallMs / 1000}s`,
        );
        return EXIT_STALL;
      }
      if (interrupted()) return EXIT_INTERRUPTED;
      if (error instanceof FrameTooLargeError) {
        deps.logError(`lane-watch: ${error.message}`);
        return EXIT_ERROR;
      }
      deps.logError(`lane-watch: ${errorText(error)}`);
      return EXIT_ERROR;
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    deps.external?.removeEventListener("abort", onExternal);
    controller.abort();
  }
}
