import { NOT_ONE_LINE } from "../fix-brief/args.js";

/**
 * The command line of `hexagen-orchestration-brief-new`.
 *
 * Every value is written into the brief verbatim, so the parser refuses a
 * command line the tool cannot act on BEFORE the overlay is loaded: an argv
 * mistake is exit 2 and costs nothing.
 */
export interface BriefNewArgs {
  readonly lane: string;
  readonly plan: string;
  readonly branch: string;
  readonly tip: string;
  readonly host: string;
  /** `KEY=VALUE`, one per `--env`, in the order given. */
  readonly env: readonly string[];
  /** Absent means the brief goes to stdout. */
  readonly out?: string;
}

export const BRIEF_NEW_USAGE =
  "usage: hexagen-orchestration-brief-new --lane <id> --plan <path> --branch <name> " +
  "--tip <sha> --host <name> [--env KEY=VALUE]... [--out <path>]";

const LANE_PATTERN = /^[A-Za-z0-9_-]+$/;
const PATH_PATTERN = /^[A-Za-z0-9._/-]+$/;
const TIP_PATTERN = /^[0-9a-f]{7,40}$/;
const ENV_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * A flag's value as the command line gave it. `--flag=value` is `inline`: it
 * may start with `--`, which is how a value such as `--draft.md` is written. In
 * the spaced form, `--flag value`, a word starting with `--` is the NEXT flag,
 * so the value is missing.
 */
interface Given {
  readonly raw: string | undefined;
  readonly inline: boolean;
}

function valueOf({ raw, inline }: Given, flag: string): string {
  if (raw === undefined || (!inline && raw.startsWith("--"))) {
    throw new Error(`missing value for ${flag}\n${BRIEF_NEW_USAGE}`);
  }
  if (raw.trim() === "") {
    throw new Error(`${flag} was given an empty value\n${BRIEF_NEW_USAGE}`);
  }
  return raw;
}

/** A value held to one line for a stated reason, with no shape rule of its own. */
function singleLineOf(given: Given, flag: string, why: string): string {
  const raw = valueOf(given, flag);
  if (NOT_ONE_LINE.test(raw)) {
    throw new Error(
      `${flag} must be a single line: ${why}\n${BRIEF_NEW_USAGE}`,
    );
  }
  return raw;
}

/**
 * A header value. The one-line rule comes first so the refusal says WHY a value
 * holding a newline is refused (it would be a second line of the brief), and
 * the shape rule then says what the flag accepts.
 */
function headerOf(
  given: Given,
  flag: string,
  shape: RegExp,
  shapeText: string,
): string {
  const raw = valueOf(given, flag);
  if (NOT_ONE_LINE.test(raw)) {
    throw new Error(
      `${flag} must be a single line: it is written into the brief verbatim\n${BRIEF_NEW_USAGE}`,
    );
  }
  if (!shape.test(raw)) {
    throw new Error(
      `${flag} must be ${shapeText}, got '${raw}'\n${BRIEF_NEW_USAGE}`,
    );
  }
  return raw;
}

/**
 * Parses the command line. A value is given as `--flag value` or `--flag=value`.
 * Every flag but `--env` states one value, so a second
 * one is refused rather than letting the last silently win. `--env` is
 * repeatable: each is `KEY=VALUE` with an identifier for the key, and a single
 * line, since it is written into the brief verbatim. `--out` is never written
 * into the brief, but it is echoed in the summary line, so it is held to the
 * same single-line rule rather than being sanitised on the way out.
 */
export function parseBriefNewArgs(argv: readonly string[]): BriefNewArgs {
  const seen = new Set<string>();
  const once = (flag: string): void => {
    if (seen.has(flag)) {
      throw new Error(
        `${flag} is given twice, and each flag states one value\n${BRIEF_NEW_USAGE}`,
      );
    }
    seen.add(flag);
  };

  let lane: string | undefined;
  let plan: string | undefined;
  let branch: string | undefined;
  let tip: string | undefined;
  let host: string | undefined;
  let out: string | undefined;
  const env: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const word = argv[i] as string;
    // `--flag=value` splits at the FIRST `=`; the value keeps any others.
    const eq = word.startsWith("--") ? word.indexOf("=") : -1;
    const flag = eq === -1 ? word : word.slice(0, eq);
    const take = (): Given =>
      eq === -1
        ? { raw: argv[++i], inline: false }
        : { raw: word.slice(eq + 1), inline: true };
    switch (flag) {
      case "--lane":
        once(flag);
        lane = headerOf(
          take(),
          flag,
          LANE_PATTERN,
          "letters, digits, '_' and '-' only",
        );
        break;
      case "--plan":
        once(flag);
        plan = headerOf(
          take(),
          flag,
          PATH_PATTERN,
          "letters, digits, '.', '_', '/' and '-' only",
        );
        break;
      case "--branch":
        once(flag);
        branch = headerOf(
          take(),
          flag,
          PATH_PATTERN,
          "letters, digits, '.', '_', '/' and '-' only",
        );
        break;
      case "--tip":
        once(flag);
        tip = headerOf(
          take(),
          flag,
          TIP_PATTERN,
          "7 to 40 lowercase hex digits",
        );
        break;
      case "--host":
        once(flag);
        host = singleLineOf(take(), flag, "it names a laneHosts entry");
        break;
      case "--env":
        env.push(
          headerOf(
            take(),
            flag,
            ENV_PATTERN,
            "KEY=VALUE, with a key of letters, digits and '_' that does not start with a digit",
          ),
        );
        break;
      case "--out":
        once(flag);
        out = singleLineOf(take(), flag, "it is echoed in the summary line");
        break;
      default:
        throw new Error(`unknown argument '${flag}'\n${BRIEF_NEW_USAGE}`);
    }
  }

  if (lane === undefined)
    throw new Error(`a --lane is required\n${BRIEF_NEW_USAGE}`);
  if (plan === undefined)
    throw new Error(`a --plan is required\n${BRIEF_NEW_USAGE}`);
  if (branch === undefined)
    throw new Error(`a --branch is required\n${BRIEF_NEW_USAGE}`);
  if (tip === undefined)
    throw new Error(`a --tip is required\n${BRIEF_NEW_USAGE}`);
  if (host === undefined)
    throw new Error(`a --host is required\n${BRIEF_NEW_USAGE}`);
  return {
    lane,
    plan,
    branch,
    tip,
    host,
    env,
    ...(out === undefined ? {} : { out }),
  };
}
