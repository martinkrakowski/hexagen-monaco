import { formatEvent, type EventInput } from "./emit.js";
import { defaultLogDir, type LogDirConfig } from "./logdir.js";
import type { EventKind, Stage } from "./wave-types.js";

/**
 * `hexagen-orchestration-wave-event` — append one event to a wave's log
 * (N-7: this is the TypeScript port of campaign-foundry's `scripts/wave-event.sh`,
 * so a project needs no `python3`).
 *
 * BOTH calling forms of the source survive, because the skill shim forwards
 * `"$@"` and every current caller uses one of them unchanged:
 *
 * ```
 * wave-event <logdir> <wave> <lane> <stage> <event> [options]
 * wave-event --logdir <dir>  <wave> <lane> <stage> <event> [options]
 * ```
 *
 * plus `--pr N`, `--round N` and `--detail '<json>'`. A `--logdir` that appears
 * AFTER the event is an unknown option, exactly as in the source: the
 * positionals are consumed first, so a flag in that position never sees the
 * leading-flag branch.
 *
 * Two rules are inherited verbatim from the source, and both are about not
 * writing garbage a reader would later have to reject:
 *
 * - Validate first, append last. Every rejection exits 2, writes nothing, and
 *   creates no directory.
 * - A wave or lane must match `^[A-Za-z0-9_-]+$`, and a `--detail` must be a
 *   JSON OBJECT. The source checked the latter with `python3`'s
 *   `isinstance(d, dict)`; here it is `JSON.parse` plus the log reader's own
 *   `isDetail`, which rejects arrays and null for the same reason.
 *
 * The line is built by `formatEvent`, not by string concatenation. The source
 * assembled the JSON by hand and documented that its output was byte-identical
 * to `formatEvent`; building it with `formatEvent` makes that a structural
 * property instead of a promise, since `formatEvent` round-trips through the
 * log's own reader before returning.
 */

/** The source's vocabularies, for the two `unknown …` messages. */
const STAGES =
  "plan-review dispatch implement gate review remediate sweep merge record";
const KINDS = "started settled failed";

const STAGE_LIST: readonly Stage[] = [
  "plan-review",
  "dispatch",
  "implement",
  "gate",
  "review",
  "remediate",
  "sweep",
  "merge",
  "record",
];
const KIND_LIST: readonly EventKind[] = ["started", "settled", "failed"];

const TOKEN = /^[A-Za-z0-9_-]+$/;

/** What the port needs from the outside world, so the whole bin is testable. */
export interface WaveEventDeps {
  /** The process environment, as `defaultLogDir` reads it. */
  readonly env: { LOGDIR?: string; HOME?: string; WAVE_LOG_ROOT?: string };
  /** The overlay's `repo` and `waveLogDir`, for the default log root (A-18). */
  readonly config?: LogDirConfig;
  readonly exists: (path: string) => boolean;
  /**
   * Whether a path is a symlink (an `lstat`, so the link itself, not its
   * target). The append refuses a symlinked `events.jsonl`: following one lets
   * whoever planted it choose where this repository's events are written.
   */
  readonly isSymlink?: (path: string) => boolean;
  readonly mkdir: (path: string) => Promise<void>;
  readonly appendFile: (path: string, data: string) => Promise<void>;
  /** ISO-8601 UTC to the second, as `date -u +%Y-%m-%dT%H:%M:%SZ` reports. */
  readonly clock: () => string;
  /** Where refusals go. Defaults to stderr. */
  readonly stderr?: (line: string) => void;
}

/** A refusal: exit 2, a reason, and nothing written. */
class Refusal extends Error {}

function refuse(message: string): never {
  throw new Refusal(message);
}

const USAGE =
  "usage: wave-event [<logdir>] <wave> <lane> <stage> <event> " +
  "[--pr N] [--round N] [--detail '<json>']";

/** The source's `--pr` / `--round` rule: digits only, and an empty value means "unset". */
function numberValue(raw: string, flag: string): number | undefined {
  if (raw === "") return undefined;
  if (!/^[0-9]+$/.test(raw)) refuse(`${flag} must be a number: ${raw}`);
  return Number(raw);
}

/** `JSON.parse` plus the log reader's own `isDetail`: an object, never an array. */
export function parseDetail(raw: string): Record<string, unknown> | undefined {
  if (raw === "") return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return refuse(`--detail must be a JSON object: ${raw}`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    refuse(`--detail must be a JSON object: ${raw}`);
  }
  return value as Record<string, unknown>;
}

/**
 * Run the bin over `argv` and return its exit code. Never throws for a caller
 * error — every refusal is a return of 2 with the reason already written.
 */
export async function runWaveEvent(
  argv: readonly string[],
  deps: WaveEventDeps,
): Promise<number> {
  const say =
    deps.stderr ?? ((line: string) => void process.stderr.write(`${line}\n`));
  const args = [...argv];

  try {
    return await write(args, deps);
  } catch (err) {
    if (err instanceof Refusal) {
      say(err.message);
      return 2;
    }
    throw err;
  }
}

async function write(args: string[], deps: WaveEventDeps): Promise<number> {
  // The source reads $LOGDIR first, then consumes a LEADING --logdir, and only
  // then decides which positional form it is looking at.
  let logdir = deps.env.LOGDIR ?? "";
  if (args.length >= 1 && args[0] === "--logdir") {
    if (args.length < 2) refuse("missing value for --logdir");
    logdir = args[1]!;
    args.splice(0, 2);
  }

  let wave: string;
  let lane: string;
  let stage: string;
  let event: string;

  // The six branches are the source's, in its order. The first two disambiguate
  // a five-argument call by asking whether its 4th and 5th arguments are a
  // stage and an event — which is what tells "logdir wave lane stage event"
  // apart from "wave lane stage event" plus an option.
  if (args.length >= 5 && isStage(args[3]!) && isEvent(args[4]!)) {
    logdir = args[0]!;
    [wave, lane, stage, event] = [args[1]!, args[2]!, args[3]!, args[4]!];
    args.splice(0, 5);
  } else if (args.length >= 4 && isStage(args[2]!) && isEvent(args[3]!)) {
    [wave, lane, stage, event] = [args[0]!, args[1]!, args[2]!, args[3]!];
    args.splice(0, 4);
  } else if (logdir !== "" && args.length >= 4) {
    [wave, lane, stage, event] = [args[0]!, args[1]!, args[2]!, args[3]!];
    args.splice(0, 4);
  } else if (args.length >= 5) {
    logdir = args[0]!;
    [wave, lane, stage, event] = [args[1]!, args[2]!, args[3]!, args[4]!];
    args.splice(0, 5);
  } else if (args.length >= 4) {
    [wave, lane, stage, event] = [args[0]!, args[1]!, args[2]!, args[3]!];
    args.splice(0, 4);
  } else {
    refuse(USAGE);
  }

  if (!isStage(stage)) {
    refuse(
      `unknown stage: ${stage} — stage is one of: ${STAGES}; event is one of: ${KINDS}`,
    );
  }
  if (!isEvent(event)) {
    refuse(
      `unknown event: ${event} — stage is one of: ${STAGES}; event is one of: ${KINDS}`,
    );
  }

  let pr: number | undefined;
  let round: number | undefined;
  let detail: Record<string, unknown> | undefined;
  while (args.length > 0) {
    const flag = args[0]!;
    if (flag === "--pr" || flag === "--round" || flag === "--detail") {
      if (args.length < 2) refuse(`missing value for ${flag}`);
      const value = args[1]!;
      args.splice(0, 2);
      if (flag === "--pr") pr = numberValue(value, "--pr");
      else if (flag === "--round") round = numberValue(value, "--round");
      else detail = parseDetail(value);
      continue;
    }
    refuse(`unknown option: ${flag}`);
  }

  if (!TOKEN.test(wave))
    refuse(`invalid wave: ${wave} — must match ${TOKEN.source}`);
  if (!TOKEN.test(lane))
    refuse(`invalid lane: ${lane} — must match ${TOKEN.source}`);

  // Only now is the default log root resolved: the source probed its candidate
  // directories before validating, but a probe writes nothing, so every
  // documented refusal above keeps its own message instead of competing with a
  // root that could not be resolved.
  if (logdir === "") {
    try {
      logdir = defaultLogDir(wave, deps.env, deps.exists, deps.config);
    } catch (err) {
      // A root that cannot be resolved is a refusal, not a crash. The source
      // would have fallen back to the shared `~/.waves` here (A-18); this port
      // refuses instead, and says so in the same shape as every other refusal.
      refuse(err instanceof Error ? err.message : String(err));
    }
  }

  const input: EventInput = {
    wave,
    // Stamped so a status server can scope a shared log root to ITS repository.
    // Omitted (never null) when no repo resolved; legacy lines simply lack it.
    ...(deps.config?.repo !== undefined ? { repo: deps.config.repo } : {}),
    lane,
    stage: stage as Stage,
    event: event as EventKind,
    ...(pr !== undefined ? { pr } : {}),
    ...(round !== undefined ? { round } : {}),
    ...(detail !== undefined ? { detail } : {}),
  };

  let line: string;
  try {
    line = formatEvent(input, deps.clock);
  } catch (err) {
    refuse(
      `invalid wave event — stage is one of: ${STAGES}; event is one of: ${KINDS}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const eventsPath = `${logdir}/events.jsonl`;
  if (deps.isSymlink?.(eventsPath) === true) {
    refuse(
      `refusing to append: ${eventsPath} is a symlink, and following it would let its author choose where events are written`,
    );
  }
  await deps.mkdir(logdir);
  await deps.appendFile(eventsPath, line);
  return 0;
}

function isStage(value: string): value is Stage {
  return (STAGE_LIST as readonly string[]).includes(value);
}

function isEvent(value: string): value is EventKind {
  return (KIND_LIST as readonly string[]).includes(value);
}
