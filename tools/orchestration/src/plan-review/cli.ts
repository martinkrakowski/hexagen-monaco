import { relative, resolve } from "node:path";
import { errorText } from "../internal/artifact.js";
import { readEvents } from "../internal/events.js";
import { defaultLogDir, type LogDirEnv } from "../internal/logdir.js";
import { latestStageSettled, prePrReviewRefusal } from "../internal/pre-pr.js";
import {
  asHashRecord,
  InvalidRiskCellError,
  rowHash,
  rowRisk,
} from "../internal/rows.js";
import { discoverRisk } from "../internal/risk.js";
import { governingPlanReview } from "../internal/review.js";
import type { Config } from "../internal/config.js";
import type { WaveEvent } from "../internal/wave-types.js";

/**
 * The plan-review gate's command face. `hashes` fingerprints the rows an
 * orchestrator is about to dispatch against — lane rows and decision rows
 * alike — so the reviewer's report can carry those fingerprints, and `check`
 * re-runs the comparison the gate promises: a lane may be dispatched only when
 * the wave's latest `plan-review settled` event recorded a clear verdict over
 * row fingerprints that still match the plan on disk. `pre-pr-check` is the
 * pre-PR-review merge gate: a `high`-risk lane's PR does not merge without a
 * pre-PR review settled in the wave log.
 *
 * The library half — `rowHash`, `rowRisk`, `discoverRisk`, `asHashRecord`,
 * `governingPlanReview`, `latestStageSettled`, `prePrReviewRefusal`,
 * `defaultLogDir` — lives in `../internal/`, and this module holds the command
 * face alone.
 *
 * ## The row grammar
 *
 * A row is named by its FIRST cell: `| **<id>** | …`. An id matching `^D\d+`
 * is a decision row and `hashes` files it under `decisions`; every other id is
 * a lane row and also gets a risk tier, because the risk column is a lane
 * property and a decision row carries none.
 *
 * ## A-1: the risk column fails CLOSED here
 *
 * A risk cell that reads like a risk word but is not one this package accepts —
 * a plain `high`, a `**high**` carrying a trailing note — is a row nobody
 * cleared, and the pre-PR gate must not treat it as low-stakes. `rowRisk` and
 * `discoverRisk` throw `InvalidRiskCellError` for exactly that cell. At the
 * source every one of those throws was caught and the command carried on, so a
 * malformed cell read as `normal` and the merge gate failed OPEN. Here an
 * `InvalidRiskCellError` from either is a refusal: the message goes to stderr
 * and the command returns 1, which the merge script reads as "refused, do not
 * merge" and nothing else.
 */

export interface PlanReviewIo {
  readonly argv: readonly string[];
  /**
   * The project's overlay, loaded ONCE by `src/bins/plan-review.ts` and
   * refused on there before any subcommand runs. `runCli` never looks it up, and
   * a test passes a config in rather than letting a temp directory walk up into
   * a real checkout.
   */
  readonly config: Config;
  /**
   * The repository root the overlay was read from — the only base a path in
   * this CLI is resolved against, never the working directory: a bin invoked
   * from a subdirectory must judge the same plan the operator's editor shows.
   */
  readonly root: string;
  readonly log: (text: string) => void;
  readonly logError: (text: string) => void;
  /** Reads a PLAN path: resolved against `root`, an absolute one left alone. */
  readonly readFile: (path: string) => Promise<string>;
  /**
   * Reads an EVENT LOG path (`--logdir`, `$LOGDIR`, `waveLogDir`, the wave-log
   * root), resolved exactly as `wave-event` writes it: against the process's
   * working directory. A relative `--logdir` names the directory the writer was
   * given from wherever it ran, and resolving it against the repository root
   * instead would read a different (or no) file.
   */
  readonly readLogFile: (path: string) => Promise<string>;
  readonly readdir: (dir: string) => Promise<readonly string[]>;
  /** Whether `path` exists — the same test `defaultLogDir` reclaims a real directory with. */
  readonly exists: (path: string) => boolean;
  readonly env: LogDirEnv;
}

const USAGE =
  "usage: hexagen-orchestration-plan-review hashes <plan.md> <id>…\n" +
  "       hexagen-orchestration-plan-review check <plan.md> --logdir <dir> --wave <wave> <laneId>\n" +
  "       hexagen-orchestration-plan-review pre-pr-check <laneId> --wave <wave> [--logdir <dir>]";

/** Decision ids sort under `decisions`; every other id is a lane row. */
function isDecisionId(id: string): boolean {
  return /^D\d+/.test(id);
}

/**
 * The form plan paths are compared in: a relative one resolved against the
 * repository root (never the working directory — a bin invoked from a
 * subdirectory must judge the same plan the operator's editor shows), then
 * made relative to that root, so a review recorded as `docs/planning/p.md` and
 * a command line naming the same file absolutely agree, and a sibling file
 * never does.
 */
function normalisePlanPath(plan: string, root: string): string {
  return relative(root, resolve(root, plan));
}

export async function runCli(io: PlanReviewIo): Promise<number> {
  const [command, ...rest] = io.argv;
  if (command === "hashes") return hashes(rest, io);
  if (command === "check") return check(rest, io);
  if (command === "pre-pr-check") return prePrCheck(rest, io);
  io.logError(USAGE);
  return 2;
}

async function hashes(
  args: readonly string[],
  io: PlanReviewIo,
): Promise<number> {
  const [plan, ...ids] = args;
  if (plan === undefined) {
    io.logError(USAGE);
    return 2;
  }
  const markdown = await io.readFile(plan);
  const rows: Record<string, string> = {};
  const decisions: Record<string, string> = {};
  const risk: Record<string, string> = {};
  try {
    for (const id of ids) {
      const hash = rowHash(markdown, id, plan);
      if (isDecisionId(id)) {
        decisions[id] = hash;
      } else {
        rows[id] = hash;
        // Decision rows carry no risk tier — the risk column is a lane property.
        risk[id] = rowRisk(markdown, id, plan);
      }
    }
  } catch (error: unknown) {
    // A-1. Only a risk cell this package refuses is a refusal; a `rowHash` that
    // found zero or several rows still rejects, exactly as it always has, so a
    // caller asking for a row that does not exist still sees the throw.
    if (error instanceof InvalidRiskCellError) {
      io.logError(error.message);
      return 1;
    }
    throw error;
  }
  io.log(JSON.stringify({ rows, decisions, risk }));
  return 0;
}

interface CheckArgs {
  readonly plan: string;
  readonly laneId: string;
  readonly logdir: string;
  readonly wave: string;
}

function parseCheckArgs(args: readonly string[]): CheckArgs | undefined {
  const positionals: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--logdir" || arg === "--wave") {
      const value = args[i + 1];
      if (value === undefined) return undefined;
      flags.set(arg, value);
      i += 1;
    } else if (arg.startsWith("--")) {
      return undefined;
    } else {
      positionals.push(arg);
    }
  }
  const logdir = flags.get("--logdir");
  const wave = flags.get("--wave");
  if (positionals.length !== 2 || logdir === undefined || wave === undefined)
    return undefined;
  return { plan: positionals[0], laneId: positionals[1], logdir, wave };
}

/** Why `id`'s row no longer matches `reviewed`, or `undefined` when it does. */
function rowDiff(
  markdown: string,
  id: string,
  reviewed: string,
  plan: string,
): string | undefined {
  let current: string;
  try {
    current = rowHash(markdown, id, plan);
  } catch (error: unknown) {
    return `${id} (no unambiguous row: ${errorText(error)})`;
  }
  return current === reviewed ? undefined : id;
}

/**
 * The log as the gate reads it: every event with the line it came from, and
 * every line the reader cannot accept — a rejected line, or the torn tail of
 * a file whose writer died mid-line. One walk through the same reader the
 * whole system parses with, line by line, so the gate's view of "unreadable"
 * is the reader's own, never a second opinion.
 */
function readLog(text: string): {
  readonly events: readonly WaveEvent[];
  readonly lineOf: readonly number[];
  readonly unreadable: readonly number[];
} {
  const physical = text.split("\n");
  if (text.endsWith("\n")) physical.pop(); // the artifact of the trailing newline, not a line
  const events: WaveEvent[] = [];
  const lineOf: number[] = [];
  const unreadable: number[] = [];
  for (let i = 0; i < physical.length; i++) {
    if (physical[i].trim() === "") continue;
    const read = readEvents(physical[i]);
    for (const event of read.events) {
      events.push(event);
      lineOf.push(i);
    }
    if (read.events.length === 0) unreadable.push(i);
  }
  return { events, lineOf, unreadable };
}

async function check(
  args: readonly string[],
  io: PlanReviewIo,
): Promise<number> {
  const parsed = parseCheckArgs(args);
  if (parsed === undefined) {
    io.logError(USAGE);
    return 2;
  }
  const { plan, laneId, logdir, wave } = parsed;
  const logPath = `${logdir}/events.jsonl`;

  let eventsText: string;
  try {
    eventsText = await io.readLogFile(logPath);
  } catch (error: unknown) {
    io.logError(`could not read ${logPath}: ${errorText(error)}`);
    return 2;
  }

  const log = readLog(eventsText);
  const review = governingPlanReview(log.events, wave);
  if (review === undefined) {
    io.logError(`no plan-review settled event for wave ${wave} in ${logPath}`);
    return 2;
  }

  // Fail closed on an unreadable tail: a line the reader cannot accept that
  // is newer than the chosen review leaves the log's own word unknown — the
  // chosen review may already have been superseded by one that never parsed.
  const tornAfter = log.unreadable.filter(
    (line) => line > log.lineOf[review.index],
  );
  if (tornAfter.length > 0) {
    io.logError(
      `${logPath} has unreadable line(s) ${tornAfter.map((line) => line + 1).join(", ")} after the latest plan-review event — the log tail cannot be read`,
    );
    return 2;
  }

  // The review governs the plan it was taken against, and nothing else: the
  // latest review of a different plan file is no review for this lane, even
  // when the two plans' rows coincide — the row hashes would match while the
  // verdict was never asked about this file.
  const reviewedPlan = review.plan;
  if (reviewedPlan === undefined) {
    io.logError(
      `the latest plan-review settled event for wave ${wave} names no plan file — no review for this lane`,
    );
    return 2;
  }
  if (
    normalisePlanPath(reviewedPlan, io.root) !==
    normalisePlanPath(plan, io.root)
  ) {
    io.logError(
      `the latest review for wave ${wave} is of ${reviewedPlan}, not ${plan} — no review for this lane`,
    );
    return 2;
  }

  const rows = asHashRecord(review.event.detail?.rows);
  if (rows === undefined) {
    io.logError(
      `the latest plan-review event for wave ${wave} carries no usable rows map`,
    );
    return 2;
  }
  const reviewed = rows[laneId];
  if (reviewed === undefined) {
    io.logError(
      `lane ${laneId} is absent from the review's rows for wave ${wave}`,
    );
    return 2;
  }

  const verdict = review.event.detail?.verdict;
  if (typeof verdict !== "string") {
    io.logError(`the review of wave ${wave} carries no verdict`);
    return 2;
  }
  if (verdict === "changes-required") {
    io.logError(
      `the review of ${plan} for wave ${wave} ended changes-required`,
    );
    return 3;
  }
  if (verdict !== "clear") {
    io.logError(`verdict ${verdict} is neither clear nor changes-required`);
    return 1;
  }

  let markdown: string;
  try {
    markdown = await io.readFile(plan);
  } catch (error: unknown) {
    io.logError(`could not read ${plan}: ${errorText(error)}`);
    return 2;
  }

  // Report the row's risk tier once the plan is in hand, whatever the diff
  // below finds — a caller wants the tier alongside the verdict, not only on
  // a clean pass. A row that vanished since the review has no tier to give;
  // rowDiff below already says why in its own words. A risk cell this package
  // REFUSES is a different matter: it is not a vanished row, it is a tier
  // nobody cleared, so the command refuses (1) rather than continuing on a
  // plan whose risk column cannot be read (A-1).
  try {
    io.log(`risk: ${rowRisk(markdown, laneId, plan)}`);
  } catch (error: unknown) {
    if (error instanceof InvalidRiskCellError) {
      io.logError(error.message);
      return 1;
    }
    // no unambiguous row — silent here, loud in the diff below.
  }

  const decisionsDetail = review.event.detail?.decisions;
  let decisions: Record<string, string> = {};
  if (decisionsDetail !== undefined) {
    // An absent decisions field is a review that recorded none; a present
    // one that fails to read is a broken record, and a broken record may
    // not be read as "nothing to compare" — the gate fails closed.
    const parsed = asHashRecord(decisionsDetail);
    if (parsed === undefined) {
      io.logError(
        `the latest plan-review event for wave ${wave} carries a malformed decisions map`,
      );
      return 2;
    }
    decisions = parsed;
  }
  const diffs = [
    rowDiff(markdown, laneId, reviewed, plan),
    ...Object.entries(decisions).map(([id, hash]) =>
      rowDiff(markdown, id, hash, plan),
    ),
  ].filter((diff) => diff !== undefined);
  if (diffs.length > 0) {
    io.logError(`plan changed since the review: ${diffs.join("; ")}`);
    return 1;
  }
  return 0;
}

interface PrePrCheckArgs {
  readonly lane: string;
  readonly wave: string;
  readonly logdir?: string;
}

function parsePrePrCheckArgs(
  args: readonly string[],
): PrePrCheckArgs | undefined {
  const positionals: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--logdir" || arg === "--wave") {
      const value = args[i + 1];
      if (value === undefined) return undefined;
      flags.set(arg, value);
      i += 1;
    } else if (arg.startsWith("--")) {
      return undefined;
    } else {
      positionals.push(arg);
    }
  }
  const wave = flags.get("--wave");
  if (positionals.length !== 1 || wave === undefined) return undefined;
  return { lane: positionals[0], wave, logdir: flags.get("--logdir") };
}

/**
 * The pre-PR-review merge gate, run by `bin/merge-prs` before it touches a PR at
 * all: `pre-pr-check <laneId> --wave <wave> [--logdir <dir>]`. Exit 0 is OK (a
 * `normal` row is never blocked — this must be true even when the wave log
 * cannot be read at all), exit 1 is refuse (named reason on stderr), exit 2
 * is a usage error.
 *
 * `--logdir` is optional: omitted, it resolves exactly as the event writer does
 * (`defaultLogDir`, with this project's `repo` and `waveLogDir`), so the two
 * never name a different directory for the same wave. Given, it names the
 * directory outright — the same override an operator hands the event writer
 * itself.
 */
async function prePrCheck(
  args: readonly string[],
  io: PlanReviewIo,
): Promise<number> {
  const parsed = parsePrePrCheckArgs(args);
  if (parsed === undefined) {
    io.logError(USAGE);
    return 2;
  }
  const { lane, wave, logdir: givenLogdir } = parsed;

  // Where `pre-pr-check` greps for a lane's row — the project's own planning
  // directory under the repository root, never a constant and never a
  // caller-supplied path.
  const planningDir = resolve(io.root, io.config.planDir);

  let risk: Awaited<ReturnType<typeof discoverRisk>>;
  try {
    risk = await discoverRisk(lane, planningDir, io);
  } catch (error: unknown) {
    // A-1: a risk cell this package refuses, in a plan that names this lane, is
    // a refusal, not a miss. The error names both the plan file and the row, so
    // the operator can find the cell that has to be fixed.
    if (error instanceof InvalidRiskCellError) {
      io.logError(error.message);
      return 1;
    }
    throw error;
  }
  // Fail closed: a lane no plan names, or a planning directory that could not be
  // read at all, is refused — never waved through as "normal". A misspelt
  // lane id must not disarm this gate.
  if (risk === undefined) {
    io.logError(`no plan row for lane ${lane} under ${io.config.planDir}`);
    return 1;
  }
  if (risk === "normal") {
    io.log(`${lane}: risk=normal — no pre-PR review required`);
    return 0;
  }

  const logdir =
    givenLogdir ??
    defaultLogDir(wave, io.env, io.exists, {
      ...(io.config.repo !== undefined ? { repo: io.config.repo } : {}),
      ...(io.config.waveLogDir !== undefined
        ? { waveLogDir: io.config.waveLogDir }
        : {}),
    });
  const logPath = `${logdir}/events.jsonl`;
  let eventsText: string;
  try {
    eventsText = await io.readLogFile(logPath);
  } catch (error: unknown) {
    // Fail closed: a high-risk lane whose log cannot be read has not been
    // shown to hold a settled review, so this is a refusal, not a usage
    // error — the merge is the thing that must not proceed either way.
    io.logError(
      `could not read ${logPath}: ${errorText(error)} — no stage=review event=settled for lane ${lane} in wave ${wave}`,
    );
    return 1;
  }

  // The same torn-tail fail-closed rule `check` applies (readLog, relative
  // to the governing event's own line): a line the reader cannot accept that
  // is newer than the review this gate is about to trust means the log's own
  // word is unknown — the review found may already be superseded by a line
  // that never parsed.
  const log = readLog(eventsText);
  const review = latestStageSettled(log.events, wave, lane, "review");
  if (review !== undefined) {
    const tornAfter = log.unreadable.filter(
      (line) => line > log.lineOf[review.index],
    );
    if (tornAfter.length > 0) {
      io.logError(
        `${logPath} has unreadable line(s) ${tornAfter.map((line) => line + 1).join(", ")} after the ` +
          `latest stage=review event for lane ${lane} — the log tail cannot be read`,
      );
      return 1;
    }
  }

  const refusal = prePrReviewRefusal(log.events, wave, lane);
  if (refusal !== undefined) {
    io.logError(refusal);
    return 1;
  }
  io.log(`${lane}: risk=high — pre-PR review settled`);
  return 0;
}
