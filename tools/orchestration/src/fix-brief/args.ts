/**
 * The command line of `hexagen-orchestration-fix-brief`.
 *
 * Everything the brief's header carries is a value the caller typed, written
 * into the brief verbatim, one per line. The parser's job is to refuse a
 * command line the tool cannot act on BEFORE anything is fetched: an argv
 * mistake is exit 2 and costs no forge call.
 */
export interface FixBriefArgs {
  readonly pr: number;
  readonly round: number;
  readonly lane: string;
  readonly worktree: string;
  readonly branch: string;
  readonly tip: string;
  /** Absent means the brief goes to stdout. */
  readonly out?: string;
}

export const FIX_BRIEF_USAGE =
  "usage: hexagen-orchestration-fix-brief --pr <number> --round <number> --lane <id> " +
  "--worktree <path> --branch <name> --tip <sha> [--out <path>]";

/**
 * What may NOT appear in a value the header carries: a control character, or a
 * line or paragraph separator. A `--lane` holding a newline is not a lane id
 * with a newline in it, it is a second line of the brief, and a line reading
 * `## Item 4` is then an item heading. The value is refused (exit 2), not
 * quietly mangled: it is the caller's own typing.
 */
const NOT_ONE_LINE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

function valueAfter(argv: readonly string[], i: number, flag: string): string {
  const raw = argv[i];
  if (raw === undefined || raw.startsWith("--")) {
    throw new Error(`missing value for ${flag}\n${FIX_BRIEF_USAGE}`);
  }
  if (raw.trim() === "") {
    throw new Error(`${flag} was given an empty value\n${FIX_BRIEF_USAGE}`);
  }
  return raw;
}

/** A counter: digits only, a positive safe integer. `0` is no PR, and 400 digits is Infinity. */
function counterAfter(
  argv: readonly string[],
  i: number,
  flag: string,
): number {
  const raw = valueAfter(argv, i, flag);
  const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(
      `${flag} wants a positive whole number, got '${raw}'\n${FIX_BRIEF_USAGE}`,
    );
  }
  return value;
}

function lineAfter(argv: readonly string[], i: number, flag: string): string {
  const raw = valueAfter(argv, i, flag);
  if (NOT_ONE_LINE.test(raw)) {
    throw new Error(
      `${flag} must be a single line: it is written into the brief's header verbatim\n${FIX_BRIEF_USAGE}`,
    );
  }
  return raw;
}

/**
 * Parses the command line. A flag given twice is refused: every flag states one
 * value, so a second one is a caller whose script appended to a command line
 * rather than composing it, and taking the last would hide that.
 * `--out` is a path and a log line, never written into the brief, so it is not
 * held to the single-line rule.
 */
export function parseFixBriefArgs(argv: readonly string[]): FixBriefArgs {
  const seen = new Set<string>();
  const once = (flag: string): void => {
    if (seen.has(flag)) {
      throw new Error(
        `${flag} is given twice, and each flag states one value\n${FIX_BRIEF_USAGE}`,
      );
    }
    seen.add(flag);
  };

  let pr: number | undefined;
  let round: number | undefined;
  let lane: string | undefined;
  let worktree: string | undefined;
  let branch: string | undefined;
  let tip: string | undefined;
  let out: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i] as string;
    switch (flag) {
      case "--pr":
        once(flag);
        pr = counterAfter(argv, ++i, flag);
        break;
      case "--round":
        once(flag);
        round = counterAfter(argv, ++i, flag);
        break;
      case "--lane":
        once(flag);
        lane = lineAfter(argv, ++i, flag);
        break;
      case "--worktree":
        once(flag);
        worktree = lineAfter(argv, ++i, flag);
        break;
      case "--branch":
        once(flag);
        branch = lineAfter(argv, ++i, flag);
        break;
      case "--tip":
        once(flag);
        tip = lineAfter(argv, ++i, flag);
        break;
      case "--out":
        once(flag);
        out = valueAfter(argv, ++i, flag);
        break;
      default:
        throw new Error(`unknown argument '${flag}'\n${FIX_BRIEF_USAGE}`);
    }
  }

  if (pr === undefined)
    throw new Error(`a --pr is required\n${FIX_BRIEF_USAGE}`);
  if (round === undefined)
    throw new Error(`a --round is required\n${FIX_BRIEF_USAGE}`);
  if (lane === undefined)
    throw new Error(`a --lane is required\n${FIX_BRIEF_USAGE}`);
  if (worktree === undefined)
    throw new Error(`a --worktree is required\n${FIX_BRIEF_USAGE}`);
  if (branch === undefined)
    throw new Error(`a --branch is required\n${FIX_BRIEF_USAGE}`);
  if (tip === undefined)
    throw new Error(`a --tip is required\n${FIX_BRIEF_USAGE}`);
  return {
    pr,
    round,
    lane,
    worktree,
    branch,
    tip,
    ...(out === undefined ? {} : { out }),
  };
}
