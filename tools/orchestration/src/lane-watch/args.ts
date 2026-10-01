import {
  parseLoopbackServer,
  SESSION_ID_PATTERN,
} from "../internal/loopback-server.js";

/** A command line that cannot be acted on. The CLI answers it with exit 2. */
export class ArgError extends Error {}

export const DEFAULT_STALL_SECONDS = 120;
const MAX_STALL_SECONDS = 86_400;

export type LaneWatchArgs =
  | {
      readonly command: "follow";
      readonly origin: string;
      readonly session: string;
      readonly stallMs: number;
    }
  | {
      readonly command: "usage";
      readonly origin: string;
      readonly session: string;
    };

/**
 * `follow|usage --server <url> --session <id> [--stall-seconds <n>]`.
 *
 * Every refusal happens here, BEFORE any network call: `--server` must be a
 * loopback origin and `--session` must match the session-id pattern, so a value
 * that could point the tool elsewhere or reshape a request path never reaches a
 * request.
 */
export function parseLaneWatchArgs(argv: readonly string[]): LaneWatchArgs {
  const [command, ...rest] = argv;
  if (command !== "follow" && command !== "usage") {
    throw new ArgError(
      command === undefined
        ? "expected a subcommand: follow or usage"
        : `unknown subcommand ${JSON.stringify(command)}: expected follow or usage`,
    );
  }
  const allowed = new Set(
    command === "follow"
      ? ["--server", "--session", "--stall-seconds"]
      : ["--server", "--session"],
  );
  const values = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 1) {
    const word = rest[i]!;
    if (!word.startsWith("--")) {
      throw new ArgError(`unexpected argument ${JSON.stringify(word)}`);
    }
    const eq = word.indexOf("=");
    const flag = eq === -1 ? word : word.slice(0, eq);
    if (!allowed.has(flag)) {
      throw new ArgError(`unknown flag ${JSON.stringify(flag)} for ${command}`);
    }
    if (values.has(flag)) throw new ArgError(`${flag} given twice`);
    let value: string | undefined;
    if (eq !== -1) value = word.slice(eq + 1);
    else {
      value = rest[i + 1];
      i += 1;
    }
    if (value === undefined) throw new ArgError(`${flag} needs a value`);
    values.set(flag, value);
  }

  const server = values.get("--server");
  if (server === undefined) throw new ArgError("--server is required");
  const parsed = parseLoopbackServer(server);
  if (!parsed.ok) throw new ArgError(`--server ${parsed.message}`);

  const session = values.get("--session");
  if (session === undefined) throw new ArgError("--session is required");
  if (!SESSION_ID_PATTERN.test(session)) {
    throw new ArgError(
      `--session must match ${SESSION_ID_PATTERN.source}. Read ${JSON.stringify(session)}`,
    );
  }

  if (command === "usage") {
    return { command, origin: parsed.origin, session };
  }
  const rawStall = values.get("--stall-seconds");
  let stallSeconds = DEFAULT_STALL_SECONDS;
  if (rawStall !== undefined) {
    stallSeconds = Number(rawStall);
    if (
      rawStall.trim() === "" ||
      !Number.isFinite(stallSeconds) ||
      stallSeconds <= 0 ||
      stallSeconds > MAX_STALL_SECONDS
    ) {
      throw new ArgError(
        `--stall-seconds must be a number above 0 and at most ${MAX_STALL_SECONDS}. Read ${JSON.stringify(rawStall)}`,
      );
    }
  }
  return {
    command,
    origin: parsed.origin,
    session,
    stallMs: Math.round(stallSeconds * 1000),
  };
}
