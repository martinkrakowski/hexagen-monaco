import { ArgError, parseLaneWatchArgs } from "./args.js";
import { EXIT_USAGE, errorText } from "./errors.js";
import { follow } from "./follow.js";
import { makeGet, type FetchLike } from "./server.js";
import { LANE_WATCH_USAGE } from "./usage-text.js";
import { usage } from "./usage.js";

/**
 * Everything `runLaneWatch` touches outside itself, injected, so a test can
 * point it at a local fake and see every request it makes.
 */
export interface LaneWatchIo {
  readonly argv: readonly string[];
  readonly log: (text: string) => void;
  readonly logError: (text: string) => void;
  readonly fetch: FetchLike;
  /** Aborted from outside, e.g. by SIGINT. */
  readonly signal?: AbortSignal;
}

/** How long `usage` waits for one small JSON answer. */
const USAGE_TIMEOUT_MS = 30_000;

/**
 * The AbortController is made here and aborted by the command in a `finally`,
 * so every exit path (done, stalled, refused, unparseable, thrown) releases the
 * connection.
 */
export async function runLaneWatch(io: LaneWatchIo): Promise<number> {
  let args;
  try {
    args = parseLaneWatchArgs(io.argv);
  } catch (error: unknown) {
    if (!(error instanceof ArgError)) throw error;
    io.logError(`lane-watch: ${errorText(error)}`);
    io.logError(LANE_WATCH_USAGE);
    return EXIT_USAGE;
  }

  const controller = new AbortController();
  const get = makeGet(io.fetch, args.origin, controller.signal);
  if (args.command === "follow") {
    return follow({
      get,
      controller,
      ...(io.signal !== undefined ? { external: io.signal } : {}),
      session: args.session,
      stallMs: args.stallMs,
      log: io.log,
      logError: io.logError,
    });
  }
  const deadline = setTimeout(() => controller.abort(), USAGE_TIMEOUT_MS);
  try {
    return await usage({
      get,
      controller,
      session: args.session,
      log: io.log,
      logError: io.logError,
    });
  } finally {
    clearTimeout(deadline);
  }
}
