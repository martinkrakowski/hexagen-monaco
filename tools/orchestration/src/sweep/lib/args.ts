/** `sweep gate --pr <n> --sha <sha>`: the PR, and the head its checks were read on. */
export interface GateArgs {
  readonly pr: number;
  readonly head: string;
}

export interface SweepArgs {
  readonly pr: number;
  readonly threadIds: readonly string[];
  /** `--body`'s text, or the file path from `--body-file` — resolved by the caller. */
  readonly body: { readonly text: string } | { readonly file: string };
  readonly post: boolean;
}

/**
 * Parses `sweep threads --pr <n> --thread <id>... (--body <text> |
 * --body-file <path>) [--post]`.
 *
 * Thread ids are verbatim GraphQL node ids (`PRRT_…`), repeated once per
 * thread of the class. The short `PRVT_…` form that appears in review
 * emails and the web UI names the *discussion*, not the thread node —
 * `resolveReviewThread` rejects it — and ids are kept opaque here because
 * the only reliable check is against the PR's real thread list, which
 * `sweep.ts` runs before anything is written.
 *
 * `--body-file` exists because a disposition is prose with backticks and
 * em-dashes; quoting that through a shell is how a reply gets mangled
 * between the terminal and the timeline.
 *
 * Throws with the usage line for anything the tool cannot act on: a
 * missing `--pr`, a non-numeric `--pr`, an option starved of its value, no
 * `--thread` at all, both body sources or neither, an unknown argument.
 */
export const SWEEP_USAGE =
  "usage: hexagen-orchestration-sweep threads --pr <number> --thread <PRRT_id> " +
  "[--thread …] (--body <text> | --body-file <path>) [--post]";

/** Reads the value that must follow a long option, or fails with the caller's usage. */
function valueAfter(
  argv: readonly string[],
  i: number,
  flag: string,
  usage: string,
): string {
  const raw = argv[i];
  if (raw === undefined || raw.startsWith("--")) {
    throw new Error(`missing value for ${flag}\n${usage}`);
  }
  return raw;
}

/** Reads a whole number after a long option, or fails with the caller's usage line. */
function numberAfter(
  argv: readonly string[],
  i: number,
  flag: string,
  usage: string,
): number {
  const raw = valueAfter(argv, i, flag, usage);
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${flag} wants a number, got '${raw}'\n${usage}`);
  }
  return Number(raw);
}

export function parseSweepArgs(argv: readonly string[]): SweepArgs {
  let pr: number | undefined;
  const threadIds: string[] = [];
  let text: string | undefined;
  let file: string | undefined;
  let post = false;

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case "--pr": {
        pr = numberAfter(argv, ++i, flag, SWEEP_USAGE);
        break;
      }
      case "--thread": {
        threadIds.push(valueAfter(argv, ++i, flag, SWEEP_USAGE));
        break;
      }
      case "--body": {
        text = valueAfter(argv, ++i, flag, SWEEP_USAGE);
        if (text.trim() === "") {
          throw new Error(
            `a disposition body must not be blank\n${SWEEP_USAGE}`,
          );
        }
        break;
      }
      case "--body-file": {
        file = valueAfter(argv, ++i, flag, SWEEP_USAGE);
        break;
      }
      case "--post": {
        post = true;
        break;
      }
      default:
        throw new Error(`unknown argument '${String(flag)}'\n${SWEEP_USAGE}`);
    }
  }

  if (pr === undefined) throw new Error(`a --pr is required\n${SWEEP_USAGE}`);
  if (threadIds.length === 0) {
    throw new Error(`at least one --thread is required\n${SWEEP_USAGE}`);
  }
  if (text !== undefined && file !== undefined) {
    throw new Error(
      `--body and --body-file are mutually exclusive\n${SWEEP_USAGE}`,
    );
  }
  if (text === undefined && file === undefined) {
    throw new Error(
      `a disposition body is required (--body or --body-file)\n${SWEEP_USAGE}`,
    );
  }
  const body = text !== undefined ? { text } : { file: file as string };
  return { pr, threadIds, body, post };
}

export const GATE_USAGE =
  "usage: hexagen-orchestration-sweep gate --pr <number> --sha <sha>";

/**
 * Parses `sweep gate --pr <n> --sha <sha>`.
 *
 * `--sha` is the head whose check-runs were read green, supplied by the caller
 * that verified them. It is required rather than re-derived here: the gate
 * compares what the PR stands at now against what was verified, and a gate
 * that fetched its own head to compare with would have nothing to compare.
 */
export function parseGateArgs(argv: readonly string[]): GateArgs {
  let pr: number | undefined;
  let head: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case "--pr": {
        pr = numberAfter(argv, ++i, flag, GATE_USAGE);
        break;
      }
      case "--sha": {
        head = valueAfter(argv, ++i, flag, GATE_USAGE);
        break;
      }
      default:
        throw new Error(`unknown argument '${String(flag)}'\n${GATE_USAGE}`);
    }
  }

  if (pr === undefined) throw new Error(`a --pr is required\n${GATE_USAGE}`);
  if (head === undefined) throw new Error(`a --sha is required\n${GATE_USAGE}`);
  return { pr, head };
}

/** `sweep attribute --pr <n>`: the PR whose bot threads will be split by workflow. */
export interface AttributeArgs {
  readonly pr: number;
}

export const ATTRIBUTE_USAGE =
  "usage: hexagen-orchestration-sweep attribute --pr <number>\n" +
  "UI reviews triggered by an /improve comment (issue_comment) run on the default branch, so they are not found by the PR's commits and come out unattributed (safe). An Architecture log with no model response is the same.";

/**
 * Parses `sweep attribute --pr <n>`.
 *
 * The PR is the only input: the head branch, the three review-agent workflow
 * runs, and the threads all follow from it. Anything else on the command
 * line is a mistake, not an option, because a guessed flag would look like
 * a filter the tool does not have.
 *
 * Coverage that stays `unattributed` (safe): UI reviews triggered by an
 * `/improve` comment (`issue_comment`) run on the default branch, so they
 * are not among the PR's commits. An Architecture run whose log carries
 * no model response has nothing to match.
 */
export function parseAttributeArgs(argv: readonly string[]): AttributeArgs {
  let pr: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case "--pr": {
        pr = numberAfter(argv, ++i, flag, ATTRIBUTE_USAGE);
        break;
      }
      default:
        throw new Error(
          `unknown argument '${String(flag)}'\n${ATTRIBUTE_USAGE}`,
        );
    }
  }

  if (pr === undefined)
    throw new Error(`a --pr is required\n${ATTRIBUTE_USAGE}`);
  return { pr };
}

/* ------------------------------------------------------------------ *
 * The subcommands `bin/merge-prs` calls.
 *
 * At the source each of these was a separate interpreter invocation from a
 * zsh script — four of them, each carrying its own copy of a pattern or a
 * JSON read. They are commands here so ONE implementation owns every pattern
 * and every parse, and so each is testable without a shell.
 * ------------------------------------------------------------------ */

export const KEEP_BOTH_USAGE =
  "usage: hexagen-orchestration-sweep keep-both <file>";

/** `keep-both <file>`: exactly one path, the conflicted file to resolve in place. */
export function parseKeepBothArgs(argv: readonly string[]): {
  readonly path: string;
} {
  if (argv.length !== 1) {
    throw new Error(`keep-both takes exactly one file\n${KEEP_BOTH_USAGE}`);
  }
  const path = argv[0];
  if (path === undefined || path === "" || path.startsWith("--")) {
    throw new Error(`keep-both needs the file to resolve\n${KEEP_BOTH_USAGE}`);
  }
  return { path };
}

export const APPEND_ONLY_USAGE =
  "usage: hexagen-orchestration-sweep append-only <path>…";

/**
 * `append-only <path>…`: one or more paths to test against the project's
 * append-only pattern. Zero paths is a usage error rather than a vacuous pass:
 * the caller passed nothing to check, and a check that checked nothing must
 * not read as a check that passed.
 */
export function parseAppendOnlyArgs(argv: readonly string[]): {
  readonly paths: string[];
} {
  if (argv.length === 0) {
    throw new Error(
      `append-only needs at least one path\n${APPEND_ONLY_USAGE}`,
    );
  }
  for (const arg of argv) {
    if (arg === "" || arg.startsWith("--")) {
      throw new Error(
        `append-only takes paths, got '${arg}'\n${APPEND_ONLY_USAGE}`,
      );
    }
  }
  return { paths: [...argv] };
}

export const CHECKS_USAGE =
  "usage: hexagen-orchestration-sweep checks < runs.json\n" +
  "reads the check-run array on stdin and prints one line: pending=<n> required=<n> bad=<names>";

/** `checks`: the array arrives on stdin, so the command line takes nothing. */
export function parseChecksArgs(
  argv: readonly string[],
): Record<string, never> {
  if (argv.length > 0) {
    throw new Error(
      `checks takes its input on stdin, not arguments\n${CHECKS_USAGE}`,
    );
  }
  return {};
}

/** The one field `sweep config` can report. */
export const CONFIG_FIELDS = ["requiredCheck"] as const;

export const CONFIG_USAGE = `usage: hexagen-orchestration-sweep config <${CONFIG_FIELDS.join("|")}>`;

/** `config <field>`: one field name, and only one this command can answer. */
export function parseConfigArgs(argv: readonly string[]): {
  readonly field: (typeof CONFIG_FIELDS)[number];
} {
  const field = argv[0];
  if (argv.length !== 1 || field === undefined) {
    throw new Error(`config needs exactly one field\n${CONFIG_USAGE}`);
  }
  if (!(CONFIG_FIELDS as readonly string[]).includes(field)) {
    throw new Error(`config has no field '${field}'\n${CONFIG_USAGE}`);
  }
  return { field: field as (typeof CONFIG_FIELDS)[number] };
}
