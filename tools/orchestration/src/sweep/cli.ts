import {
  APPEND_ONLY_USAGE,
  ATTRIBUTE_USAGE,
  CHECKS_USAGE,
  CONFIG_USAGE,
  GATE_USAGE,
  KEEP_BOTH_USAGE,
  SWEEP_USAGE,
  parseAppendOnlyArgs,
  parseAttributeArgs,
  parseChecksArgs,
  parseConfigArgs,
  parseGateArgs,
  parseKeepBothArgs,
  parseSweepArgs,
  type AttributeArgs,
} from "./lib/args.js";
import { attribute } from "./lib/attribute.js";
import { mergeGate, type MergeGatePlan } from "./lib/gate.js";
import { sweep, errorText, type SweepPlan } from "./lib/sweep.js";
import { matchesAppendOnly } from "../internal/config.js";
import type { Config } from "../internal/config.js";
import { SweepRefusal, type RepoRef } from "./lib/types.js";

export const SWEEP_COMMAND = "threads";
export const GATE_COMMAND = "gate";
export const ATTRIBUTE_COMMAND = "attribute";
export const KEEP_BOTH_COMMAND = "keep-both";
export const APPEND_ONLY_COMMAND = "append-only";
export const CHECKS_COMMAND = "checks";
export const CONFIG_COMMAND = "config";

/**
 * `gh` colorizes JSON when `FORCE_COLOR` is set, even if stdout is not a
 * TTY — `JSON.parse` then dies on the ANSI prefix, which is how a working
 * GraphQL reply looks like a failed fetch. Drop the color force so the
 * child writes the bytes the parsers already test.
 */
export function ghChildEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next = { ...env };
  delete next["FORCE_COLOR"];
  delete next["CLICOLOR_FORCE"];
  return next;
}

/** `node:child_process`'s `execFile`, as far as `makeGh` uses it. */
export type ExecFileLike = (
  file: string,
  args: readonly string[],
  options: { maxBuffer: number; env: NodeJS.ProcessEnv },
  callback: (error: Error | null, stdout: string, stderr: string) => void,
) => unknown;

/**
 * The bin's `gh`: run it, resolve its stdout, reject on a non-zero exit.
 *
 * The rejection CARRIES the child's stdout. `gh api graphql` exits 1 when the
 * response holds `errors`, and it still prints the whole body — including the
 * `data` a partly applied mutation returned. Discarding it would make "a comment
 * may already have been posted" unanswerable, so a caller that wants the body
 * reads `error.stdout`.
 */
export function makeGh(
  exec: ExecFileLike,
  env: NodeJS.ProcessEnv,
): (args: readonly string[]) => Promise<string> {
  return (args) =>
    new Promise((resolvePromise, reject) => {
      exec(
        "gh",
        [...args],
        { maxBuffer: 16 * 1024 * 1024, env: ghChildEnv(env) },
        (error, stdout, stderr) => {
          if (error !== null) {
            reject(
              Object.assign(
                new Error(
                  `gh ${args.slice(0, 2).join(" ")}: ${stderr.trim() || error.message}`,
                ),
                { stdout },
              ),
            );
          } else {
            resolvePromise(stdout);
          }
        },
      );
    });
}

/** The two environment variables the merge-script subcommands read. */
export interface SweepEnv {
  /**
   * A caller-exported append-only pattern. Set and non-empty, it is the
   * effective pattern; otherwise the project's own `appendOnlyPaths` stands.
   */
  readonly APPEND_ONLY?: string;
  /** Overrides `config.requiredCheck` for the `checks` and `config` commands. */
  readonly REQUIRED_CHECK?: string;
}

export interface SweepCliIo {
  readonly argv: readonly string[];
  /** The project's overlay, loaded once by the bin and refused on there. */
  readonly config: Config;
  /** The repository root every path in this CLI is resolved against. */
  readonly root: string;
  /** The one repository every `gh` call is pointed at. */
  readonly repo: RepoRef;
  readonly log: (text: string) => void;
  readonly logError: (text: string) => void;
  readonly readFile: (path: string) => Promise<string>;
  readonly writeFile: (path: string, contents: string) => Promise<void>;
  /** The check-run array `checks` reads, whole. */
  readonly readStdin: () => Promise<string>;
  readonly env: SweepEnv;
  readonly gh: (args: readonly string[]) => Promise<string>;
}

/**
 * `sweep gate --pr <n> --sha <sha>`
 *
 * Exit codes: 0 every merge condition was decided in favour of the merge;
 * 1 a condition is unmet (an unresolved thread, a head that moved) or could
 * not be decided — a refusal, with every reason listed; 2 the command line
 * itself is wrong.
 *
 * 1 never merges anything: the caller owns `gh pr merge`, and this is the last
 * thing it asks before running it.
 */
async function runGate(
  rest: readonly string[],
  io: SweepCliIo,
): Promise<number> {
  let plan: MergeGatePlan;
  try {
    plan = parseGateArgs(rest);
  } catch (error) {
    io.logError(errorText(error));
    return 2;
  }
  const decision = await mergeGate(plan, { gh: io.gh, repo: io.repo });
  if (decision.kind === "refuse") {
    io.logError(
      `refusing to merge PR #${plan.pr} — ${decision.reasons.length} reason(s), nothing was merged:`,
    );
    for (const reason of decision.reasons) io.logError(`  ${reason}`);
    return 1;
  }
  io.log(`PR #${plan.pr}: merge condition met — ${decision.summary}`);
  return 0;
}

/**
 * `sweep attribute --pr <n>`
 *
 * Exit codes: 0 every bot thread was printed (attributed or
 * unattributed); 1 the threads, the PR's commits, a truncated run list, or
 * a job log could not be read — nothing was guessed; 2 the command line
 * itself is wrong.
 *
 * UI reviews triggered by an `/improve` comment (`issue_comment`) run on the
 * default branch, so they are not found by the PR's commits and come
 * out `unattributed` (safe). An Architecture log with no model response is
 * the same.
 */
async function runAttribute(
  rest: readonly string[],
  io: SweepCliIo,
): Promise<number> {
  let plan: AttributeArgs;
  try {
    plan = parseAttributeArgs(rest);
  } catch (error) {
    io.logError(errorText(error));
    return 2;
  }
  const decision = await attribute(plan, { gh: io.gh, repo: io.repo });
  if (decision.kind === "fail") {
    for (const reason of decision.reasons) io.logError(reason);
    return 1;
  }
  for (const line of decision.lines) io.log(line);
  return 0;
}

/**
 * The conflict hunk `keep-both` resolves, as the source's own resolver matched
 * it: `<<<<<<< …\n(ours)=======\n(theirs)>>>>>>> …\n`, both sides captured
 * NON-GREEDILY and DOTALL, replaced by ours then theirs.
 *
 * Non-greedy is what makes two hunks in one file resolve in order rather than
 * the first `<<<<<<<` swallowing everything to the last `>>>>>>>`: each match
 * ends at the first `=======` and the first `>>>>>>>` after it. A nested
 * `<<<<<<<` inside a hunk leaves the result carrying a marker, which is the
 * refusal below — the resolver never guesses which nesting was meant.
 */
const CONFLICT_HUNK =
  /<<<<<<< [^\n]*\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>> [^\n]*\n/g;

/**
 * `sweep keep-both <file>`
 *
 * The one resolver for the case where two branches legitimately appended to
 * the same file: keep both sides, ours first. Exit 0 on a file that was
 * resolved and written; 1 with `keep-both resolver made no progress on
 * <path>` when nothing changed or a marker survives, in which case the file
 * on disk is left exactly as it was.
 */
async function runKeepBoth(
  rest: readonly string[],
  io: SweepCliIo,
): Promise<number> {
  let path: string;
  try {
    path = parseKeepBothArgs(rest).path;
  } catch (error) {
    io.logError(errorText(error));
    return 2;
  }
  let original: string;
  try {
    original = await io.readFile(path);
  } catch (error: unknown) {
    io.logError(`could not read ${path}: ${errorText(error)}`);
    return 1;
  }
  // The source read through Python's universal newlines, so `\r\n` and a lone
  // `\r` both arrived as `\n` and the hunk pattern's `\n` matched them. A raw
  // read does not, so the same normalisation happens here, and the normalised
  // text is what is written (and what "no progress" is measured against).
  const text = original.replace(/\r\n?/g, "\n");
  const merged = text.replace(
    CONFLICT_HUNK,
    (_match, ours: string, theirs: string) => ours + theirs,
  );
  // "Made no progress" is the source's own test, and it covers the two ways a
  // resolver can fail without an exception: nothing matched (the file was not
  // conflicted, or was already resolved), or a marker survived (a nested or
  // unterminated hunk). Writing either would destroy the file's conflict
  // markers and leave a merge nothing can resolve by hand.
  if (merged === text || merged.includes("<<<<<<<")) {
    io.logError(`keep-both resolver made no progress on ${path}`);
    return 1;
  }
  await io.writeFile(path, merged);
  return 0;
}

/**
 * The config the append-only test runs against: a caller-exported
 * `APPEND_ONLY` when it is set and non-empty, otherwise the project's own.
 *
 * The override is compiled ONLY through `matchesAppendOnly` — the same
 * function the config loader's own validation uses — never as a second regex
 * built here. An effective pattern that is absent or empty matches nothing, so
 * a project that configured no append-only path has every conflict die for a
 * human, which is the correct outcome and not a silent pass.
 */
function appendOnlyConfig(config: Config, env: SweepEnv): Config {
  const override = env.APPEND_ONLY;
  if (override === undefined || override === "") return config;
  return { ...config, appendOnlyPaths: override };
}

/**
 * `sweep append-only <path>…`
 *
 * Exit 0 when EVERY path is append-only; 1 naming the FIRST that is not — one
 * name is the whole answer a merge script needs, and a list of every
 * non-append-only path would read as an invitation to pick the friendlier one.
 */
async function runAppendOnly(
  rest: readonly string[],
  io: SweepCliIo,
): Promise<number> {
  let paths: readonly string[];
  try {
    paths = parseAppendOnlyArgs(rest).paths;
  } catch (error) {
    io.logError(errorText(error));
    return 2;
  }
  const config = appendOnlyConfig(io.config, io.env);
  // Compile the effective pattern ONCE, up front. A pattern that will not
  // compile is a fault in the caller's input, not a path that failed to match:
  // 1 means "this path is not append-only" and a merge script answers it by
  // dying with a conflict report, which would blame the file for the pattern.
  const effective = config.appendOnlyPaths;
  if (effective !== undefined && effective !== "") {
    try {
      new RegExp(effective);
    } catch (error: unknown) {
      io.logError(
        `the append-only pattern is not a valid regular expression: ${errorText(error)}`,
      );
      return 2;
    }
  }
  for (const path of paths) {
    if (!matchesAppendOnly(config, path)) {
      io.logError(`${path} is not an append-only path`);
      return 1;
    }
  }
  return 0;
}

/** One check-run as `gh api .../check-runs --jq` projects it. */
interface CheckRun {
  readonly n: string;
  readonly s: string;
  /** `null` while a run has not concluded — which is not one of the good answers. */
  readonly c: string | null;
}

const GOOD_CONCLUSIONS: ReadonlySet<string> = new Set([
  "success",
  "neutral",
  "skipped",
]);

/**
 * The array the `checks` command reads, or `undefined` when it is not one.
 *
 * `n` and `s` must be strings, and `c` must be present — a string or `null`,
 * because that is what a run with no conclusion yet projects to, and `null` is
 * NOT one of the acceptable conclusions. Anything else is refused rather than
 * counted: a missing `s` would read as "not completed" and a missing `c` as
 * "not success", so a truncated payload would report a healthy PR as pending
 * and a broken one as clean.
 */
function parseCheckRuns(text: string): readonly CheckRun[] | undefined {
  const rows = parseRows(text);
  if (rows === undefined) return undefined;
  const runs: CheckRun[] = [];
  for (const row of rows) {
    if (row === null || typeof row !== "object" || Array.isArray(row))
      return undefined;
    const { n, s, c } = row as { n?: unknown; s?: unknown; c?: unknown };
    if (typeof n !== "string" || typeof s !== "string") return undefined;
    if (c !== null && typeof c !== "string") return undefined;
    runs.push({ n, s, c });
  }
  return runs;
}

/**
 * The rows of the payload: one JSON array, or NDJSON — one object per line,
 * which is what `gh api --paginate --jq '.check_runs[] | {…}'` emits across
 * every page (a `--jq` filter runs per page, so it cannot produce one array).
 * A payload that is neither is `undefined`, and so is an empty one: a caller
 * with no runs to report sends `[]`.
 */
function parseRows(text: string): readonly unknown[] | undefined {
  try {
    const whole: unknown = JSON.parse(text);
    return Array.isArray(whole) ? whole : [whole];
  } catch {
    // Not one JSON value; try one value per line.
  }
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  if (lines.length < 2) return undefined;
  const rows: unknown[] = [];
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line));
    } catch {
      return undefined;
    }
  }
  return rows;
}

/** The check name whose run gates the merge: the caller's override, else the project's. */
function requiredCheck(config: Config, env: SweepEnv): string {
  const override = env.REQUIRED_CHECK;
  return override !== undefined && override !== ""
    ? override
    : config.requiredCheck;
}

/**
 * `sweep checks` — one line on stdout, parsed from the check-run array on
 * stdin: `pending=<n> required=<n> bad=<names>`.
 *
 * The three counts are the ones the merge script used to take from three
 * separate interpreter invocations, with their semantics unchanged:
 *
 * - `pending` counts runs whose status is not `completed`;
 * - `required` counts runs whose NAME matches the required-check pattern, as a
 *   SEARCH and not a full match — so `^Build` also counts `Build and lint`;
 * - `bad` lists the names of runs whose conclusion is not one of `success`,
 *   `neutral` or `skipped` — a run that has not concluded has none, and is
 *   listed — joined by `,` with no spaces, and is PRESENT even when empty,
 *   because a caller that has to distinguish "none failed" from "the field was
 *   missing" must not have to infer it.
 *
 * Malformed input prints nothing on stdout at all and exits 2: a merge script
 * reading a half-written line would decide a merge on half an answer.
 */
async function runChecks(
  rest: readonly string[],
  io: SweepCliIo,
): Promise<number> {
  try {
    parseChecksArgs(rest);
  } catch (error) {
    io.logError(errorText(error));
    return 2;
  }
  let text: string;
  try {
    text = await io.readStdin();
  } catch (error: unknown) {
    io.logError(
      `could not read the check-run array on stdin: ${errorText(error)}`,
    );
    return 2;
  }
  const runs = parseCheckRuns(text);
  if (runs === undefined) {
    io.logError(`stdin is not a JSON array of {n,s,c} check runs`);
    return 2;
  }
  let pattern: RegExp;
  try {
    pattern = new RegExp(requiredCheck(io.config, io.env));
  } catch (error: unknown) {
    io.logError(
      `the required-check pattern is not a valid regular expression: ${errorText(error)}`,
    );
    return 2;
  }
  const pending = runs.filter((run) => run.s !== "completed").length;
  const required = runs.filter((run) => pattern.test(run.n)).length;
  const bad = runs
    .filter((run) => run.c === null || !GOOD_CONCLUSIONS.has(run.c))
    .map((run) => run.n)
    .join(",");
  io.log(`pending=${pending} required=${required} bad=${bad}`);
  return 0;
}

/**
 * `sweep config <field>`
 *
 * One resolved value on stdout, so a shell script can read a project setting
 * without parsing YAML and without hardcoding a default that the overlay may
 * have changed. The value is the RESOLVED one — the caller's override when it
 * set one, the overlay's own setting otherwise.
 */
async function runConfig(
  rest: readonly string[],
  io: SweepCliIo,
): Promise<number> {
  let field: string;
  try {
    field = parseConfigArgs(rest).field;
  } catch (error) {
    io.logError(errorText(error));
    return 2;
  }
  if (field === "requiredCheck") {
    io.log(requiredCheck(io.config, io.env));
    return 0;
  }
  if (field === "repo") {
    // The resolved `owner/name`, as the bin's own refusal already guarantees it
    // exists; still answered defensively, because an empty line would read as a
    // repository to a caller that only checks the exit code.
    const repo = io.config.repo;
    if (repo === undefined || repo === "") {
      io.logError("config has no repo: set `repo` in the overlay");
      return 2;
    }
    io.log(repo);
    return 0;
  }
  io.logError(`config has no field '${field}'\n${CONFIG_USAGE}`);
  return 2;
}

/**
 * `sweep threads --pr … --thread … (--body … | --body-file …) [--post]`
 *
 * Exit codes: 0 the class was disposed (or previewed); 1 the sweep refused
 * (ids not verbatim open threads on the PR) or failed; 2 the command line
 * itself is wrong. A refusal exits 1 with every offending id listed — it is
 * a finding about the ids, not a crash.
 *
 * `sweep gate` is the other verb: the merge condition, answered from the same
 * threads query. `keep-both`, `append-only`, `checks` and `config` are the
 * fourth group: the patterns and parses `bin/merge-prs` used to carry in a
 * shell, so one implementation owns all of them.
 */
export async function runCli(io: SweepCliIo): Promise<number> {
  const [command, ...rest] = io.argv;
  if (command === GATE_COMMAND) {
    return runGate(rest, io);
  }
  if (command === ATTRIBUTE_COMMAND) {
    return runAttribute(rest, io);
  }
  if (command === KEEP_BOTH_COMMAND) {
    return runKeepBoth(rest, io);
  }
  if (command === APPEND_ONLY_COMMAND) {
    return runAppendOnly(rest, io);
  }
  if (command === CHECKS_COMMAND) {
    return runChecks(rest, io);
  }
  if (command === CONFIG_COMMAND) {
    return runConfig(rest, io);
  }
  if (command !== SWEEP_COMMAND) {
    io.logError(`sweep: '${String(command)}' is not a command.`);
    io.logError(SWEEP_USAGE);
    io.logError(GATE_USAGE);
    io.logError(ATTRIBUTE_USAGE);
    io.logError(KEEP_BOTH_USAGE);
    io.logError(APPEND_ONLY_USAGE);
    io.logError(CHECKS_USAGE);
    io.logError(CONFIG_USAGE);
    return 2;
  }
  let plan: SweepPlan;
  let post: boolean;
  try {
    const args = parseSweepArgs(rest);
    const disposition =
      "text" in args.body ? args.body.text : await io.readFile(args.body.file);
    if (disposition.trim() === "") {
      throw new Error(`a disposition body must not be blank\n${SWEEP_USAGE}`);
    }
    plan = { pr: args.pr, requested: args.threadIds, disposition };
    post = args.post;
  } catch (error) {
    io.logError(error instanceof Error ? error.message : String(error));
    return 2;
  }
  try {
    const result = await sweep(plan, post, {
      gh: io.gh,
      out: io.log,
      repo: io.repo,
    });
    if (!post) return 0;
    if (result.commentUrl === null) {
      io.logError(
        "the comment did not report a url; re-check the PR before trusting the resolves.",
      );
      return 1;
    }
    const unresolved = plan.requested.filter(
      (id) => !result.resolvedThreadIds.includes(id),
    );
    if (unresolved.length > 0) {
      io.logError(
        `these ids did not come back resolved: ${unresolved.join(", ")} — re-read the PR, do not retry blindly.`,
      );
      return 1;
    }
    io.log(`class disposed: ${result.commentUrl}`);
    return 0;
  } catch (error) {
    if (error instanceof SweepRefusal) {
      io.logError(error.message);
      for (const reason of error.reasons) io.logError(`  ${reason}`);
      return 1;
    }
    io.logError(errorText(error));
    return 1;
  }
}
