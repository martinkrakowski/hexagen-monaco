import { execFile } from "node:child_process";
import {
  open as fsOpen,
  readdir as fsReaddir,
  readFile as fsReadFile,
  realpath as fsRealpath,
  stat as fsStat,
} from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { readEvents } from "../../internal/events.js";
import { readBacklog } from "../../internal/backlog.js";
import { artifactPathFor } from "../../internal/artifact.js";
import { PLAN_REVIEW_LANE, rowHash } from "../../internal/rows.js";
import { discoverRisk } from "../../internal/risk.js";
import { prePrReviewRefusal } from "../../internal/pre-pr.js";
import { planReviewFacts } from "./derive.js";
import { mergeStatus } from "./merge.js";
import type {
  LaneObservation,
  PlanReviewObservation,
  PrChecks,
  RiskObservation,
  WaveEvent,
  WaveStatus,
} from "../../internal/wave-types.js";

/**
 * A readable file opened for a ranged tail. `FileHandle` satisfies this;
 * tests inject a counter so a whole-file read cannot hide.
 */
export interface TailHandle {
  stat(): Promise<{ readonly size: number; readonly mtimeMs: number }>;
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ readonly bytesRead: number }>;
  close(): Promise<void>;
}

/**
 * The process-facing side of collection. Everything impure is behind this
 * interface — `collect` itself only orchestrates, so tests drive it through
 * stubs and never touch the filesystem or the network.
 */
export interface CollectDeps {
  readonly readdir: (dir: string) => Promise<readonly string[]>;
  readonly readFile: (path: string) => Promise<string>;
  /**
   * Reads a plan file an EVENT named. The path is data from a log, so the real
   * reader refuses anything that is not a regular file inside the repository
   * (a device, a pipe, a symlink out) and anything over `PLAN_MAX_BYTES`,
   * throwing a `PlanPathRefusal`. When absent, `readFile` is used.
   */
  readonly readPlan?: (path: string) => Promise<string>;
  readonly open: (path: string) => Promise<TailHandle>;
  readonly pgrep: (pattern: string) => Promise<number>;
  readonly gh: (args: readonly string[]) => Promise<string>;
  readonly git?: (args: readonly string[]) => Promise<string>;
  readonly planVerifyArtifactPath?: string;
  /**
   * `config.requiredCheck`: a regular expression (source text) naming the
   * check runs a pull request's checks are read from. Default `^Build`, the
   * same default the config carries. Compiled once per collection.
   */
  readonly requiredCheck?: string;
  /**
   * The REPOSITORY root, as `findRepositoryRoot` resolved it. Every `git` child
   * process runs from here, and a plan a review named by a repo-relative path
   * is read from here — a bin must not depend on the directory it happened to
   * be started in.
   */
  readonly repoRoot: string;
  /**
   * `owner/name`, as the project's overlay records it. Every `gh` API path and
   * the thread search are addressed with it; a hardcoded repository is exactly
   * what a packaged tool may not carry.
   */
  readonly repo: string;
  /**
   * Where the pre-PR-review gate greps for a lane's row — `path.resolve(
   * repoRoot, config.planDir)`. There is no default: a packaged tool that
   * assumes one project's plan directory works on exactly one project.
   */
  readonly planningDir: string;
  /** `config.waveLogDir`, when the project set one, for the plan-verify artifact path. */
  readonly waveLogDir?: string;
}

/**
 * The status body this tool serves: the shared `WaveStatus` plus the one field
 * the server owns. `collect` never sets it — a collection either produces a
 * status or throws — but every face of the tool renders the body, so the shape
 * is declared once, here, next to the reader that produces it.
 */
export interface StatusBody extends WaveStatus {
  /** The message of the collection that failed, when one did. */
  readonly error?: string;
}

/** The most of a plan file an event's path may make the collector read. */
export const PLAN_MAX_BYTES = 5 * 1024 * 1024;

/**
 * A plan path that an event named and the collector will not read: outside the
 * repository, not a regular file, or too large. It is a COLLECTION error — it
 * propagates out of `collect` and reaches the page as the failure's message —
 * because a plan path that cannot be trusted is not "the plan could not be
 * read"; it is a log asking the collector to read something else.
 */
export class PlanPathRefusal extends Error {
  constructor(path: string, why: string) {
    super(`plan path ${JSON.stringify(path)} refused: ${why}`);
    this.name = "PlanPathRefusal";
  }
}

/**
 * `gh api --paginate` over `state=all` returns the repository's WHOLE pull
 * request history, which outgrows Node's 1 MiB `execFile` default (the child
 * is killed with ERR_CHILD_PROCESS_STDIO_MAXBUFFER and the collection fails)
 * and can outlast a 10 s bound. Both are set for every `gh` call, generously:
 * a hung `gh` still ends, and a large repository still lists.
 */
export const GH_MAX_BUFFER_BYTES = 32 * 1024 * 1024;
export const GH_TIMEOUT_MS = 60_000;

/** How much of a lane log travels with the observation (the EXIT marker lives at the end). */
export const LOG_TAIL_BYTES = 16 * 1024;

/** Public `?tail=` is in KB; anything above this is 400, not an unbounded read. */
export const MAX_TAIL_KB = 1024;

/**
 * The evidence rule for a lane, stated once because everything downstream
 * rests on it: **evidence creates a lane; a log only ever attaches to one.**
 * A lane exists because something *says* it does — an event in that
 * directory's `events.jsonl` naming it. The orchestrator emits that event in
 * the call immediately before it launches the lane, so a dispatched lane is
 * named by its own first event; a runner that emits nothing keeps its log, its
 * process and its silence to itself, and the page says nothing about it —
 * invisible is honest where a phantom row is not.
 *
 * A `.log` file never buys a row. Its name is a caller's free-form token, so
 * no name-based acceptance *or* rejection lives on this path: acceptance is an
 * event, and an attach is the event lane's own name found in the directory
 * listing, exact. An orphan log is not a lane and not an error. Counting a
 * directory's logs as lanes is how one long session's files of gate rounds and
 * fix transcripts rendered as a page of lanes that never ran.
 */

/**
 * One PR as the collector sees it: the observation's facts plus the
 * normalised branch tail (`headRefName` minus any `feat/`-style prefix,
 * lowercased) that the fallback join runs on. The lane's own event `pr`
 * number is the preferred join; the tail is only a fallback.
 */
export interface PrFact extends NonNullable<LaneObservation["pr"]> {
  readonly branchTail: string;
}

/**
 * The heads the wave actually names. `prFacts` fetches check-runs only for the
 * open PRs a lane claims — the event's own `pr`, or a branch tail some lane
 * matches — so the sweep grows with the wave, not with the repository.
 */
export interface PrScope {
  readonly lanes: ReadonlySet<string>;
  readonly reportedPrs: ReadonlySet<number>;
}

/**
 * What one `gh` PR listing parsed to. `skipped` counts the rows that came back
 * but could not be read — a truncated last line, a row the projection dropped
 * a field from. A skipped row is a gap in the corpus and is never a reason to
 * discard the rows that did read: one malformed entry emptying the batch is
 * the same fault as a missing page, and it looks like a repository with no
 * pull requests at all.
 */
export interface PrListParse {
  readonly entries: readonly GhPrListEntry[];
  readonly skipped: number;
}

/**
 * The corpus `prFacts` read: the facts it could build, and the rows it could
 * not. The two travel together so a partial corpus can never be mistaken for a
 * whole one downstream.
 */
export interface PrCorpus {
  readonly facts: readonly PrFact[];
  readonly skipped: number;
}

interface GhPrListEntry {
  readonly number: number;
  readonly state: string;
  readonly headRefName: string;
  readonly headRefOid: string;
  /**
   * The full `owner/name` the listing came from, carried by every real pull
   * object. It is NOT what the thread query addresses any more — that query
   * names the configured repository — but a row whose `repo` is absent, null or
   * a non-string is still a row nothing can stand on, and the parser's
   * acceptance rule is the same either way.
   */
  readonly repo?: string | null;
}

export function waveIdFromDirName(name: string): string {
  return name.replace(/^wave-?/, "");
}

/**
 * One wave directory as `collect` sees it, and as the log route must see it:
 * the wave id its EVENTS name (the directory name only when no event names
 * one), the lanes those events create, and the listing. `defaultLogDir` may
 * place a wave whose id itself starts with `wave` at `<root>/wave3`, where
 * stripping the prefix would give `3` while the events say `wave3`.
 */
export interface WaveDirView {
  readonly dirName: string;
  readonly wave: string;
  readonly dir: string;
  readonly entries: readonly string[];
  readonly dirEvents: readonly WaveEvent[];
  readonly reportedPrByLane: ReadonlyMap<string, number>;
  /** Every lane an event names, the reserved plan-review token excluded. */
  readonly eventLanes: ReadonlySet<string>;
}

/**
 * The wave directories under `root` that `collect` lists, in its order: sorted
 * by name, the first directory for a wave id winning, a wave whose events name
 * another repository hidden. `collect` and the log route BOTH go through this,
 * so a log is served only for a lane the page would show.
 * `skip` holds wave ids already taken by an earlier root.
 */
export async function scanWaveDirs(
  deps: Pick<CollectDeps, "readdir" | "readFile" | "repo">,
  root: string,
  skip: ReadonlySet<string> = new Set(),
): Promise<WaveDirView[]> {
  let dirNames: readonly string[];
  try {
    dirNames = await deps.readdir(root);
  } catch {
    return [];
  }
  const taken = new Set(skip);
  const views: WaveDirView[] = [];
  // Lexicographic is not the output order — it is the stable base the output
  // order is a permutation of: waves of equal (or absent) newest activity must
  // come out in a deterministic order, not readdir's.
  for (const name of dirNames.filter((n) => n.startsWith("wave")).sort()) {
    const dir = join(root, name);
    let entries: readonly string[];
    try {
      entries = await deps.readdir(dir);
    } catch {
      continue;
    }

    // Events are read before anything else because they are the lane
    // evidence itself: every lane an event names gets exactly one row, and
    // only then does an identically named `<lane>.log` attach to it. A log
    // no event names is the orchestrator's working litter — a gate round, a
    // fix transcript, a probe — and the page says nothing about it. The
    // directory that holds a log also holds the events reporting that log's
    // PR, whatever the events' own wave field says.
    const reportedPrByLane = new Map<string, number>();
    const eventLanes = new Set<string>();
    let dirEvents: readonly WaveEvent[] = [];
    if (entries.includes("events.jsonl")) {
      try {
        const text = await deps.readFile(join(dir, "events.jsonl"));
        dirEvents = readEvents(text).events;
        for (const event of dirEvents) {
          // The reserved token reviews the wave; it is never a lane — no
          // row, no probe, no gate-log lookup, no PR join. The events stay
          // in dirEvents, where the plan-review derivation reads them.
          if (event.lane !== PLAN_REVIEW_LANE) {
            eventLanes.add(event.lane);
            if (event.pr !== undefined)
              reportedPrByLane.set(event.lane, event.pr);
          }
        }
      } catch {
        // The event writer writes events.jsonl; absent or unreadable is
        // "nobody reported", not an error.
      }
    }

    // REPO SCOPING. A wave belongs to the repository its events say it does.
    // A single event naming a DIFFERENT repository hides the whole wave:
    // joining another project's lanes against this repository's pull requests
    // is how a wave shows false "no PR" flags. An event with no `repo` at all
    // is a legacy or repo-less write and never hides anything, and a wave
    // directory whose events could not be read is shown — a just-dispatched
    // wave is the state an operator most wants to see.
    if (
      dirEvents.some(
        (event) => event.repo !== undefined && event.repo !== deps.repo,
      )
    ) {
      continue;
    }

    const named = dirEvents.find((event) => event.wave !== "")?.wave;
    const wave = named ?? waveIdFromDirName(name);
    if (taken.has(wave)) continue;
    taken.add(wave);
    views.push({
      dirName: name,
      wave,
      dir,
      entries,
      dirEvents,
      reportedPrByLane,
      eventLanes,
    });
  }
  return views;
}

/**
 * The roots a collection scans. Exactly one, and it is the one the caller
 * chose: the source's shared home-directory root and its machine-wide `/tmp`
 * fallback are both gone, because a scan that reads either one joins this
 * repository's waves against another project's. The per-repository root comes
 * from `waveLogRoot(env, config)`, the same resolution the event writer used.
 */
export function resolveScanRoots(root: string): readonly string[] {
  return [root];
}

/**
 * Walk the wave log tree and build the one `WaveStatus` the server renders.
 * Failing reads shrink the observation (no log, no gate). A `gh` failure rejects
 * so PR facts are never silently dropped as an empty list (which would falsely
 * indicate no pull requests exist).
 *
 * `scanRoot` is the WAVE LOG ROOT the event writer resolved — never the
 * repository root, and never a shared directory. `repoRoot`, `repo` and
 * `planningDir` come from the project overlay on `deps`.
 *
 * `knownCorpus`, when provided, is reused as-is — rows and gap together: a
 * watcher-triggered refresh re-reads local state without waiting on `gh`, and
 * the corpus it reuses is exactly as complete as the one it was read as. Omit
 * it (or pass nothing) to fetch PR facts now — startup, the slow poll,
 * on-demand. When fetched, the corpus is handed to `onCorpus` so the caller
 * can cache it for the next watcher refresh.
 */
export async function collect(
  deps: CollectDeps,
  scanRoot: string,
  now: string,
  knownCorpus?: PrCorpus,
  onCorpus?: (corpus: PrCorpus) => void,
): Promise<WaveStatus> {
  // Gather first, order last: the wave list is decided here, the one place
  // that has seen every lane log's mtime, and it travels to the merge as an
  // explicit order. Feeds are never asked to carry it — grouping by feed is
  // how an evented old wave came to lead a live new one.
  const rows: {
    readonly wave: string;
    readonly lane: string;
    readonly reportedPr: number | undefined;
    readonly obs: Omit<LaneObservation, "pr">;
  }[] = [];
  const events: WaveEvent[] = [];
  const newestByWave = new Map<string, number>();
  const discovered = new Set<string>();
  // The heads the wave names, gathered while scanning. `prFacts` uses them to
  // fetch check-runs only for open PRs a lane claims, not every open head in
  // the repository.
  const lanes = new Set<string>();
  const reportedPrs = new Set<number>();

  const worktrees = await worktreeFacts(deps);

  // Every lane's riskFor call reads the same plan directory; without a cache, a
  // wave of N lanes re-lists the directory and re-reads every plan N times
  // over. Cheap and self-contained: cache readdir/readFile for the lifetime of
  // this one collect() call only, never across calls.
  const riskDeps: CollectDeps = { ...deps, ...cachedRiskIo(deps) };

  const scanRoots = resolveScanRoots(scanRoot);

  for (const root of scanRoots) {
    for (const view of await scanWaveDirs(deps, root, discovered)) {
      const { wave, dir, entries, dirEvents, reportedPrByLane, eventLanes } =
        view;
      discovered.add(wave);
      for (const event of dirEvents) events.push(event);

      // The plan-review gate's input is per lane: the plan file the review
      // that governed THAT lane's dispatch named, read by planReviewFor.
      // Everything else about the gate is derived from the events — the
      // collector only reads, it does not conclude.

      for (const lane of [...eventLanes].sort()) {
        const logName = `${lane}.log`;
        // An exact-name join, never a pattern: `l1-fix.log` attaches nothing
        // to lane `l1`. Membership in the directory listing is also the
        // path guard — a listing entry never contains a separator, so a
        // crafted event lane cannot climb out of the wave root.
        let log: LaneObservation["log"];
        if (entries.includes(logName)) {
          const logPath = join(dir, logName);
          try {
            const part = await readTail(deps.open, logPath, LOG_TAIL_BYTES);
            log = {
              bytes: part.size,
              mtimeMs: part.mtimeMs,
              tail: part.tail.toString("utf8"),
            };
            const prior = newestByWave.get(wave);
            if (prior === undefined || part.mtimeMs > prior)
              newestByWave.set(wave, part.mtimeMs);
          } catch {
            log = undefined;
          }
        }

        // The row a lane gets is built the same way whether or not a log
        // attached — the same shared build, probe, gate and all, and the same
        // PR join every row goes through. An event-only lane with no probe
        // behind it is a default wearing the mask of a measurement.
        const reportedPr = reportedPrByLane.get(lane);
        lanes.add(lane);
        if (reportedPr !== undefined) reportedPrs.add(reportedPr);
        const obs = await buildObservation(
          deps,
          dir,
          entries,
          lane,
          worktrees,
          await riskFor(riskDeps, dirEvents, lane),
          log,
          await planReviewFor(deps, dirEvents, lane),
        );
        rows.push({ wave, lane, reportedPr, obs });
      }
    }
  }

  // The join needs the facts, and the facts need the lanes — so fetch only now
  // that every lane and every reported `pr` has been gathered. A watcher
  // refresh hands the cached facts in and this call is skipped entirely.
  let corpus = knownCorpus;
  if (corpus === undefined) {
    corpus = await prFacts(deps, { lanes, reportedPrs });
    onCorpus?.(corpus);
  }
  const facts = corpus.facts;

  // The wave list order, decided once from the newest lane-log activity in each
  // wave, is handed to the merge as data — not implied by the order two feeds
  // happen to be walked in. Waves it cannot date keep the lexicographic base.
  const orderedWaves = [...discovered].sort((a, b) =>
    compareRecency(newestByWave.get(a), newestByWave.get(b)),
  );

  const observed: Record<string, LaneObservation> = {};
  for (const row of rows) {
    const pr = joinPrForLane(row.lane, row.reportedPr, facts);
    observed[`${row.wave}/${row.lane}`] = {
      ...row.obs,
      ...(pr !== undefined ? { pr } : {}),
    };
  }

  const status = mergeStatus(events, observed, now, orderedWaves);
  const backlogPath =
    deps.planVerifyArtifactPath ??
    artifactPathFor(process.env, {
      repo: deps.repo,
      ...(deps.waveLogDir !== undefined ? { waveLogDir: deps.waveLogDir } : {}),
    });
  const backlog = await readBacklog(deps.readFile, backlogPath, deps.repo);
  const withBacklog: WaveStatus = { ...status, backlog };
  // A corpus with rows missing is not one the page may read as complete: a
  // lane that joined no PR may be a lane whose PR was in an unreadable row.
  // Name the gap so no face of this tool can render it as "no PR".
  return corpus.skipped > 0
    ? { ...withBacklog, prs: { skipped: corpus.skipped } }
    : withBacklog;
}

/**
 * The plan-review facts one lane carries on its observation: the dispatch and
 * review facts from the wave's events, plus the lane row's hash taken from
 * the plan THE GOVERNING REVIEW named — the review `planReviewFacts` chose,
 * not whichever plan any other review in the directory mentioned. A lane that
 * never dispatched carries nothing — the gate is about dispatches. An
 * unreadable plan, a review that named no plan, or a plan without an
 * unambiguous row for the lane says why, instead of guessing a hash.
 *
 * A repo-relative plan path is read from `deps.repoRoot`, never from whatever
 * directory the process was started in.
 */
async function planReviewFor(
  deps: CollectDeps,
  dirEvents: readonly WaveEvent[],
  lane: string,
): Promise<PlanReviewObservation | undefined> {
  const facts = planReviewFacts(dirEvents, lane);
  if (facts.dispatchedAt === undefined) return undefined;
  if (facts.reviewedPlan === undefined) {
    return {
      ...facts,
      rowHashMissing: "the governing review named no plan file",
    };
  }
  const planPath = fromRepoRoot(deps.repoRoot, facts.reviewedPlan);
  const fromRoot = relative(deps.repoRoot, planPath);
  if (
    fromRoot === "" ||
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new PlanPathRefusal(
      facts.reviewedPlan,
      "it resolves outside the repository",
    );
  }
  let planText: string | undefined;
  try {
    planText = await (deps.readPlan ?? deps.readFile)(planPath);
  } catch (error) {
    if (error instanceof PlanPathRefusal) throw error;
    return { ...facts, rowHashMissing: "the plan file could not be read" };
  }
  try {
    return { ...facts, rowHash: rowHash(planText, lane) };
  } catch {
    return {
      ...facts,
      rowHashMissing: "the plan holds no unambiguous row for this lane",
    };
  }
}

/** A path a plan named: absolute as written, otherwise relative to the repository root. */
function fromRepoRoot(repoRoot: string, path: string): string {
  return isAbsolute(path) ? path : resolve(repoRoot, path);
}

/**
 * The `wave` field carried by this lane's LATEST own event in `dirEvents`,
 * in log order, or undefined. LATEST — never the first — for the same
 * reason `planReviewFacts` reads a dispatch event's wave off the newest
 * `dispatch started` line: every other "governing" lookup in this module
 * walks from the end. A directory can genuinely hold the same lane under
 * two different wave ids (a reused log directory, or a custom log directory);
 * the first-seen wave was found to pick the wrong one and pass a lane whose
 * newer wave's review never settled.
 */
export function laneWaveIn(
  events: readonly WaveEvent[],
  lane: string,
): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].lane === lane) return events[i].wave;
  }
  return undefined;
}

/**
 * A `readdir`/`readFile` pair that caches every result for the lifetime of
 * ONE `collect()` call: every lane's `riskFor` reads the same plan directory,
 * and re-listing the directory and re-reading every plan once per lane is pure
 * waste on a wave with more than a couple. A caller in flight is cached too
 * (the Map holds the promise, not its resolution), so two lanes racing the
 * same read still cost one call. Scoped to a single `collect()` invocation
 * only — never a module-level cache, which would answer a later poll with a
 * plan that has since changed on disk.
 */
function cachedRiskIo(
  deps: CollectDeps,
): Pick<CollectDeps, "readdir" | "readFile"> {
  const dirs = new Map<string, Promise<readonly string[]>>();
  const files = new Map<string, Promise<string>>();
  return {
    readdir: (dir) => {
      let cached = dirs.get(dir);
      if (cached === undefined) {
        cached = deps.readdir(dir);
        dirs.set(dir, cached);
      }
      return cached;
    },
    readFile: (path) => {
      let cached = files.get(path);
      if (cached === undefined) {
        cached = deps.readFile(path);
        files.set(path, cached);
      }
      return cached;
    },
  };
}

/**
 * The pre-PR-review gate facts for one lane: its risk tier (discovered by
 * grepping `deps.planningDir` — the collector runs the same discovery the gate
 * does, never a second opinion), and, for a `high` tier, whether the gate
 * would refuse it right now.
 *
 * The review/remediate scan is matched on the WAVE THE LANE'S OWN EVENTS
 * NAME — never `waveIdFromDirName(dirName)` — for the same reason
 * `planReviewFacts` reads `dispatchWave` off the dispatch event itself: a
 * directory's name and its events' own `wave` field can differ, and matching
 * on the wrong one would silently never find the review this lane's events
 * actually carry.
 *
 * A malformed risk cell propagates. `discoverRisk` raises it rather than
 * recording a `normal` match from some other plan, and there is deliberately
 * no catch here: a lane whose row plainly says `high` must not be reported
 * low-stakes on the strength of a cell nobody cleared.
 */
export async function riskFor(
  deps: CollectDeps,
  dirEvents: readonly WaveEvent[],
  lane: string,
): Promise<RiskObservation | undefined> {
  const tier = await discoverRisk(lane, deps.planningDir, deps);
  // discoverRisk's `undefined` (no plan names this lane, or the directory
  // could not be read) is silence here — never a claim — the same way an
  // event-only lane's missing observation is silence. The status page has no
  // opinion to render for a lane this gate has never heard of; the gate that
  // acts on the tier is the one place that must refuse on it, not the page.
  if (tier === undefined) return undefined;
  if (tier === "normal") return { tier };

  const wave = laneWaveIn(dirEvents, lane);
  if (wave === undefined) return { tier };

  const refusal = prePrReviewRefusal(dirEvents, wave, lane);
  return refusal === undefined ? { tier } : { tier, refusal };
}

/**
 * The observation every row is built with, log attached or not: one probe,
 * one gate lookup, one assembly — so a field one lane carries cannot be
 * missing from another. Two copies of this block are how an event-only lane
 * lost its gate exit and its coverage while `gate-<lane>.log` sat beside its
 * events: the loop that found the lane forgot the lookup the other loop had.
 */
async function buildObservation(
  deps: CollectDeps,
  dir: string,
  entries: readonly string[],
  lane: string,
  worktrees: readonly string[],
  // Optional again: riskFor can genuinely return undefined — a lane no plan
  // names, or an unreadable planning directory — and the status page stays
  // silent about it rather than guessing.
  risk?: RiskObservation,
  log?: LaneObservation["log"],
  planReview?: PlanReviewObservation,
): Promise<Omit<LaneObservation, "pr">> {
  let alive = false;
  try {
    alive = (await deps.pgrep(pgrepPattern(lane, worktrees))) > 0;
  } catch {
    alive = false;
  }

  const gateName = newestGateLog(entries, lane);
  let gateLog: string | undefined;
  if (gateName !== undefined) {
    try {
      gateLog = await deps.readFile(join(dir, gateName));
    } catch {
      gateLog = undefined;
    }
  }

  return {
    ...(log !== undefined ? { log } : {}),
    ...(gateLog !== undefined ? { gateLog } : {}),
    ...(planReview !== undefined ? { planReview } : {}),
    ...(risk !== undefined ? { risk } : {}),
    alive,
  };
}

/**
 * Wave order by newest lane-log activity: newer first; a wave nothing could
 * date sinks below every dated one; undated-vs-undated and equal mtimes keep
 * the discovered (lexicographic) order — Array#sort is stable.
 */
function compareRecency(a: number | undefined, b: number | undefined): number {
  if (a === undefined) return b === undefined ? 0 : 1;
  if (b === undefined) return -1;
  return b - a;
}

/**
 * Last `maxBytes` of `path`, via `open` + `read` at `max(0, size − N)`.
 * Never reads the bytes before that window. The caller must not have the
 * file open already — this opens, reads, and closes.
 */
export async function readTail(
  open: (path: string) => Promise<TailHandle>,
  path: string,
  maxBytes: number,
): Promise<{
  readonly size: number;
  readonly mtimeMs: number;
  readonly tail: Buffer;
}> {
  const handle = await open(path);
  try {
    const st = await handle.stat();
    const length = Math.min(Math.max(0, maxBytes), st.size);
    const position = Math.max(0, st.size - length);
    const buf = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buf, 0, length, position);
    return {
      size: st.size,
      mtimeMs: st.mtimeMs,
      tail: buf.subarray(0, bytesRead),
    };
  } finally {
    await handle.close();
  }
}

/**
 * Projection from REST API pull object to the GhPrListEntry shape prFacts consumes.
 * Maps .head.ref to headRefName, .head.sha to headRefOid, normalises merged state,
 * and carries the base repository's full name.
 */
export const PR_PULLS_JQ =
  '.[] | {number: .number, state: (if .merged_at then "merged" else .state end), headRefName: .head.ref, headRefOid: .head.sha, repo: .base.repo.full_name}';

/**
 * `owner/name`, split for a REST path. The overlay's loader already refuses a
 * `repo` that is not `owner/name` and the bin refuses a config with problems,
 * so this never throws through the bin; it is the type-level guard that keeps a
 * malformed value from silently addressing the wrong repository.
 */
function repoPath(repo: string): {
  readonly owner: string;
  readonly name: string;
} {
  const slash = repo.indexOf("/");
  if (
    slash <= 0 ||
    slash === repo.length - 1 ||
    repo.indexOf("/", slash + 1) !== -1
  ) {
    throw new Error(
      `cannot address the API: repo is not owner/name: ${JSON.stringify(repo)}. ` +
        `Set \`repo\` in .agents/orchestration/config.yaml.`,
    );
  }
  return { owner: repo.slice(0, slash), name: repo.slice(slash + 1) };
}

/**
 * The PR corpus, walked through the REST API. `gh api` with `--paginate`
 * follows Link headers and streams every PR in the repository, projecting each
 * to `{number, state, headRefName, headRefOid}` via jq.
 *
 * The repository is the configured one, always: `deps.repo` supplies the owner
 * and name at the listing and at every check-runs read, and the thread search
 * names it in its query. Nothing here reads a repository off the first row a
 * listing happened to return.
 *
 * `scope`, when provided, bounds the check-runs sweep to the open heads a lane
 * actually claims: the event's own `pr`, or a branch tail some lane matches.
 * An unclaimed open PR is still listed (checks none) but costs no `api` call —
 * so a refresh grows with the wave, not with every open PR in the repository.
 * Omit `scope` to fetch checks for every open head (the standalone behaviour).
 *
 * Nothing here returns an unmarked empty corpus to mean "the read failed". A
 * `gh` failure throws ("could not fetch PRs") because the fetch did not
 * happen — an empty corpus there would be indistinguishable from a repository
 * with no pull requests. Rows that came back but cannot be read are skipped
 * and carried in `skipped`, so a corpus with a hole in it is never one the
 * page may read as whole.
 */
export async function prFacts(
  deps: CollectDeps,
  scope?: PrScope,
): Promise<PrCorpus> {
  const { owner, name } = repoPath(deps.repo);
  const required = compileRequiredCheck(deps.requiredCheck);
  let stdout: string;
  try {
    stdout = await deps.gh([
      "api",
      `repos/${owner}/${name}/pulls?state=all&per_page=100`,
      "--paginate",
      "--jq",
      PR_PULLS_JQ,
    ]);
  } catch (error) {
    throw new Error(
      `could not fetch PRs: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  // Rows `gh` returned that nothing could read are counted here and travel
  // with the corpus. `gh` ran — the failure to *fetch* is the throw above —
  // so the answer is not a crash but a corpus that is not whole, which the
  // page must render as a short read rather than as no pull requests.
  const listed = parsePrList(stdout);

  // One read-only thread query for every open PR — never a call per PR. Its
  // counts land on the open facts; anything it could not reach is "unknown".
  const threadCounts = await threadCountsByPr(deps, listed.entries);

  const facts: PrFact[] = [];
  for (const entry of listed.entries) {
    const state = entry.state.toLowerCase();
    if (state !== "open" && state !== "merged" && state !== "closed") continue;

    // The initial value is the honest one: nothing has been asked yet, so
    // this is "could not ask", not "no checks have run". `none` is earned
    // only by a read that came back and found no Build runs.
    let checks: PrChecks = "unknown";
    if (state === "open" && (scope === undefined || isClaimed(entry, scope))) {
      try {
        checks = parseChecks(
          await deps.gh([
            "api",
            `repos/${owner}/${name}/commits/${entry.headRefOid}/check-runs`,
          ]),
          required,
        );
      } catch {
        // Transient check-runs failure: keep the PR, and say the read failed
        // rather than letting the default masquerade as a measurement.
        checks = "unknown";
      }
    }

    facts.push({
      number: entry.number,
      state,
      checks,
      ...(state === "open"
        ? { unresolvedThreads: threadCounts.get(entry.number) ?? "unknown" }
        : {}),
      branchTail: branchTail(entry.headRefName),
    });
  }

  return { facts, skipped: listed.skipped };
}

/**
 * Does some lane claim this open head — as its event `pr`, or a branch tail an
 * exact/descendant lane match would reach? A superset of what the join can pick
 * is fine: an over-broad yes only costs one check-runs call, whereas the
 * repository's unrelated open PRs cost none.
 */
function isClaimed(entry: GhPrListEntry, scope: PrScope): boolean {
  if (scope.reportedPrs.has(entry.number)) return true;
  const tail = branchTail(entry.headRefName);
  for (const lane of scope.lanes) {
    const needle = lane.toLowerCase();
    if (tail === needle || tail.startsWith(`${needle}-`)) return true;
  }
  return false;
}

/** `feat/x9-sample-name` → `x9-sample-name`; `main` → `main`. Lowercased. */
function branchTail(headRefName: string): string {
  const slash = headRefName.lastIndexOf("/");
  return (
    slash === -1 ? headRefName : headRefName.slice(slash + 1)
  ).toLowerCase();
}

/**
 * The read-only GraphQL search that counts the unresolved review threads of
 * every open PR in the repository in ONE query — never a call per PR, and
 * never the prose of a thread: counts and states only, because why a thread
 * is open lives in the thread. `first: 100` per page, continued by cursor,
 * which is the same pagination the PR listing already performs; a per-head
 * call would double the sweep and is refused outright by the plan.
 */
const PR_THREADS_QUERY = `query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 100, after: $after) {
    nodes {
      ... on PullRequest {
        number
        reviewThreads(first: 100) {
          pageInfo { hasNextPage }
          nodes { isResolved }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

/** Narrow an unknown JSON value to an object (arrays included: their missing keys just miss). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * One map of PR number to unresolved-thread count for the whole sweep:
 * `number` when the single query answered it, `"unknown"` when the answer
 * was truncated or unreadable, and absent from the map — which downstream
 * reads as "unknown" too — when the query could not run at all. A gh failure
 * never rejects: the PR facts stand without threads; a thread read that
 * could not be taken is a value, not a crash.
 */
async function threadCountsByPr(
  deps: CollectDeps,
  entries: readonly GhPrListEntry[],
): Promise<ReadonlyMap<number, number | "unknown">> {
  const counts = new Map<number, number | "unknown">();
  if (!entries.some((entry) => entry.state.toLowerCase() === "open"))
    return counts;
  let cursor: string | undefined;
  for (;;) {
    const args = [
      "api",
      "graphql",
      "-f",
      `query=${PR_THREADS_QUERY}`,
      "-f",
      `q=repo:${deps.repo} is:pr is:open`,
    ];
    if (cursor !== undefined) args.push("-f", `after=${cursor}`);
    let stdout: string;
    try {
      stdout = await deps.gh(args);
    } catch {
      // A page that did not arrive adds no counts. What is already in hand
      // stands — the walk stops, and every open PR missing from the map is
      // "unknown" downstream, never a silent zero.
      return counts;
    }
    const page = parseThreadPage(stdout);
    if (page === undefined) return counts;
    for (const [number, count] of page.counts) counts.set(number, count);
    if (!page.hasNextPage || page.endCursor === undefined) return counts;
    if (page.endCursor === cursor) return counts;
    cursor = page.endCursor;
  }
}

interface ThreadPage {
  readonly counts: ReadonlyMap<number, number | "unknown">;
  readonly hasNextPage: boolean;
  readonly endCursor?: string;
}

/** `undefined` for a response whose shape nothing can stand on. */
function parseThreadPage(json: string): ThreadPage | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !isRecord(parsed.data)) return undefined;
  const search = parsed.data.search;
  if (
    !isRecord(search) ||
    !Array.isArray(search.nodes) ||
    !isRecord(search.pageInfo)
  ) {
    return undefined;
  }
  const counts = new Map<number, number | "unknown">();
  for (const node of search.nodes) {
    if (!isRecord(node) || typeof node.number !== "number") continue;
    const threads = node.reviewThreads;
    if (
      !isRecord(threads) ||
      !Array.isArray(threads.nodes) ||
      !isRecord(threads.pageInfo)
    ) {
      continue;
    }
    if (typeof threads.pageInfo.hasNextPage !== "boolean") {
      counts.set(node.number, "unknown");
      continue;
    }
    counts.set(
      node.number,
      threads.pageInfo.hasNextPage === true
        ? "unknown"
        : threads.nodes.filter(isUnresolvedThread).length,
    );
  }
  return {
    counts,
    hasNextPage: search.pageInfo.hasNextPage === true,
    ...(typeof search.pageInfo.endCursor === "string"
      ? { endCursor: search.pageInfo.endCursor }
      : {}),
  };
}

function isUnresolvedThread(thread: unknown): boolean {
  return isRecord(thread) && thread.isResolved === false;
}

/**
 * The PR for one lane: the lane's own reported `pr` number if the events
 * carry one and `gh` knows that PR; otherwise the best normalised branch
 * match — an exact case-folded tail, then a `<lane>-` descendant, and among
 * equals the newest PR. `undefined` is the answer when neither exists.
 */
export function joinPrForLane(
  lane: string,
  eventPr: number | undefined,
  facts: readonly PrFact[],
): LaneObservation["pr"] | undefined {
  if (eventPr !== undefined) {
    const reported = facts.find((fact) => fact.number === eventPr);
    if (reported !== undefined) return asPr(reported);
  }

  const wanted = lane.toLowerCase();
  let best: PrFact | undefined;
  let bestScore = 0;
  for (const fact of facts) {
    const score =
      fact.branchTail === wanted
        ? 2
        : fact.branchTail.startsWith(`${wanted}-`)
          ? 1
          : 0;
    if (score === 0) continue;
    if (
      best === undefined ||
      score > bestScore ||
      (score === bestScore && fact.number > best.number)
    ) {
      best = fact;
      bestScore = score;
    }
  }
  return best === undefined ? undefined : asPr(best);
}

function asPr(fact: PrFact): LaneObservation["pr"] {
  return {
    number: fact.number,
    state: fact.state,
    checks: fact.checks,
    ...(fact.unresolvedThreads === undefined
      ? {}
      : { unresolvedThreads: fact.unresolvedThreads }),
  };
}

/** The default `requiredCheck`, the same text `config` defaults to. */
const DEFAULT_REQUIRED_CHECK = "^Build";

/**
 * Compile `requiredCheck` once. The config loader already validated it, so an
 * invalid pattern here means a caller bypassed the loader: that is a
 * collection error naming the pattern, never a silent fall back to `^Build`.
 */
function compileRequiredCheck(source: string | undefined): RegExp {
  const text = source ?? DEFAULT_REQUIRED_CHECK;
  try {
    return new RegExp(text);
  } catch (error) {
    throw new Error(
      `requiredCheck ${JSON.stringify(text)} is not a valid regular expression: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}

/**
 * The check conclusions keyed on the runs this pipeline cares about — the
 * ones whose name matches `requiredCheck` (default `^Build`). No matching runs → none (we asked, and nothing has run);
 * any unfinished → pending; any failed → fail; otherwise pass. A response
 * that cannot be read is unknown — *could not ask*, never a silent none:
 * bad JSON must never wear the same word as an empty list. Never a throw.
 */
export function parseChecks(
  json: string,
  required: RegExp = compileRequiredCheck(undefined),
): PrChecks {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return "unknown";
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.check_runs)) return "unknown";
  const builds = parsed.check_runs.filter(
    (run) =>
      isRecord(run) && typeof run.name === "string" && required.test(run.name),
  );
  if (builds.length === 0) return "none";
  if (
    builds.some(
      (run) =>
        (run as { readonly status?: unknown }).status !== "completed" ||
        (run as { readonly conclusion?: unknown }).conclusion === null,
    )
  ) {
    return "pending";
  }
  if (
    builds.some(
      (run) =>
        (run as { readonly conclusion?: unknown }).conclusion !== "success",
    )
  ) {
    return "fail";
  }
  return "pass";
}

/**
 * Parse PR list output. Supports both a single JSON array (e.g. from test
 * fixtures) and newline-delimited JSON (NDJSON streamed by `gh api --paginate
 * --jq '.[] | ...'`). A row is kept when it is an entry of `{number, state,
 * headRefName, headRefOid}`; any other row — unparseable, truncated, missing a
 * field — is skipped and counted, never allowed to discard the batch with it.
 */
export function parsePrList(stdout: string): PrListParse {
  const trimmed = stdout.trim();
  if (trimmed === "") return { entries: [], skipped: 0 };

  // One array is one batch; anything else is read a row per line. A failed
  // array parse falls through the same way — a truncated array is rows.
  const array = trimmed.startsWith("[") ? tryParseJson(trimmed) : undefined;
  const rows: readonly unknown[] = Array.isArray(array)
    ? array
    : trimmed.split("\n").filter((line) => line.trim() !== "");

  const entries: GhPrListEntry[] = [];
  let skipped = 0;
  for (const row of rows) {
    const parsed = typeof row === "string" ? tryParseJson(row) : row;
    if (isGhPrListEntry(parsed)) {
      entries.push(parsed);
    } else {
      skipped += 1;
    }
  }
  return { entries, skipped };
}

/** `undefined` for anything `JSON.parse` rejects — including the row that was cut in half. */
function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isGhPrListEntry(value: unknown): value is GhPrListEntry {
  if (typeof value !== "object" || value === null) return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.number === "number" &&
    typeof rec.state === "string" &&
    typeof rec.headRefName === "string" &&
    typeof rec.headRefOid === "string" &&
    // The projection's repository field: absent or null reads as "no repo on
    // this row" (older corpora, or a projection that lost it). Any other type
    // is a row nothing can stand on.
    (rec.repo === undefined ||
      rec.repo === null ||
      typeof rec.repo === "string")
  );
}

/**
 * The deps the real server runs with: the actual filesystem, `pgrep` and `gh`,
 * plus `repoRoot` so a `git` child process runs from the repository root
 * whichever directory the bin was started in. `repo` and `planningDir` are the
 * caller's to supply from the project overlay.
 */
export function realDepsFor(repoRoot: string): CollectDeps {
  return {
    repoRoot,
    // Overwritten by the bin from the overlay; these placeholders only exist so
    // the object satisfies the interface before that spread.
    repo: "",
    planningDir: resolve(repoRoot, "docs/planning"),
    readdir: (dir) => fsReaddir(dir),
    readFile: (path) => fsReadFile(path, "utf8"),
    readPlan: async (path) => {
      // Resolve symlinks first: the lexical check above cannot see one.
      const real = await fsRealpath(path);
      const realRoot = await fsRealpath(repoRoot);
      if (!real.startsWith(realRoot + sep)) {
        throw new PlanPathRefusal(path, "it resolves outside the repository");
      }
      // Looked at BEFORE it is opened: opening a pipe for reading blocks until
      // a writer appears.
      if (!(await fsStat(real)).isFile()) {
        throw new PlanPathRefusal(path, "it is not a regular file");
      }
      const fh = await fsOpen(real, "r");
      try {
        const st = await fh.stat();
        if (!st.isFile())
          throw new PlanPathRefusal(path, "it is not a regular file");
        if (st.size > PLAN_MAX_BYTES) {
          throw new PlanPathRefusal(
            path,
            `it is larger than ${PLAN_MAX_BYTES} bytes`,
          );
        }
        return await fh.readFile("utf8");
      } finally {
        await fh.close();
      }
    },
    open: async (path) => {
      const fh = await fsOpen(path, "r");
      return {
        stat: async () => {
          const st = await fh.stat();
          return { size: st.size, mtimeMs: st.mtimeMs };
        },
        read: (buffer, offset, length, position) =>
          fh.read(buffer, offset, length, position),
        close: () => fh.close(),
      };
    },
    pgrep: (pattern) =>
      new Promise((resolve, reject) => {
        // pgrep exits 1 when nothing matched — that is a count of zero, not a failure.
        execFile("pgrep", ["-f", pattern], (error, stdout) => {
          if (error !== null && error.code !== 1) {
            reject(error);
          } else {
            resolve(countPids(stdout));
          }
        });
      }),
    gh: (args) =>
      new Promise((resolve, reject) => {
        execFile(
          "gh",
          args,
          { timeout: GH_TIMEOUT_MS, maxBuffer: GH_MAX_BUFFER_BYTES },
          (error, stdout) => {
            if (error !== null) {
              reject(error);
            } else {
              resolve(stdout);
            }
          },
        );
      }),
    git: (args) =>
      new Promise((resolve, reject) => {
        execFile(
          "git",
          args,
          { timeout: 10_000, cwd: repoRoot },
          (error, stdout) => {
            if (error !== null) {
              reject(error);
            } else {
              resolve(stdout);
            }
          },
        );
      }),
  };
}

/**
 * Discover worktree paths from git (`git worktree list --porcelain`).
 * Any git failure yields an empty list — never a throw.
 */
export async function worktreeFacts(
  deps: CollectDeps,
): Promise<readonly string[]> {
  if (deps.git === undefined) return [];
  try {
    const stdout = await deps.git(["worktree", "list", "--porcelain"]);
    const paths: string[] = [];
    for (const line of stdout.split("\n")) {
      if (line.startsWith("worktree ")) {
        paths.push(line.slice("worktree ".length).trim());
      }
    }
    return paths;
  } catch {
    return [];
  }
}

/**
 * Derive the naming prefix from existing worktrees (e.g. `wt-` from `wt-t1`, or
 * `bay-` from `bay-c5`).
 */
export function derivePrefix(worktrees: readonly string[]): string | undefined {
  const candidates = worktrees.length > 1 ? worktrees.slice(1) : worktrees;
  for (const wt of candidates) {
    const base = basename(wt);
    const match = /^([A-Za-z0-9_]+-)[A-Za-z0-9_-]+$/.exec(base);
    if (match) return match[1];
  }
  return undefined;
}

function countPids(stdout: string): number {
  return stdout.split("\n").filter((line) => line.trim() !== "").length;
}

/** Escape a lane name for a JS / POSIX-ERE pattern. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The left boundary of every liveness pattern: the token must start at a line
 * start or right after `/`, a space or `=`. Without it the lane `t1` matched
 * inside `pytest1 run` or `abct1/x` and reported a dead lane alive.
 */
const PGREP_LEFT = "(^|[/ =])";

/**
 * `pgrep -f` is ERE against the full command line. Derive the pattern from
 * the worktree path the lane actually runs in (or the worktree naming convention
 * discovered from git), so the probe cannot silently drift from reality.
 *
 * With no worktree to learn from, the pattern is the LANE TOKEN ALONE. There is
 * no fallback project prefix: a hardcoded worktree convention is another
 * repository's fact, and a packaged tool that carried one would probe for a
 * path layout that may never exist here — reporting every lane dead.
 */
export function pgrepPattern(
  lane: string,
  worktrees?: readonly string[],
): string {
  if (worktrees !== undefined && worktrees.length > 0) {
    for (const wt of worktrees) {
      const base = basename(wt);
      if (base.endsWith(`-${lane}`) || base === lane) {
        return `${PGREP_LEFT}${escapeRegExp(base)}(/|$| )`;
      }
    }
    const prefix = derivePrefix(worktrees);
    if (prefix !== undefined) {
      return `${PGREP_LEFT}${escapeRegExp(prefix)}${escapeRegExp(lane)}(/|$| )`;
    }
  }
  return `${PGREP_LEFT}${escapeRegExp(lane)}(/|$| )`;
}

/**
 * `gate-<lane>.log` is round 0; `gate-<lane>-<n>.log` is round n. Highest n
 * wins — not lexicographic order, where `-` (45) sorts before `.` (46) and
 * `gate-u2.log` would beat `gate-u2-2.log`.
 */
function newestGateLog(
  entries: readonly string[],
  lane: string,
): string | undefined {
  const re = new RegExp(`^gate-${escapeRegExp(lane)}(?:-(\\d+))?\\.log$`);
  let bestName: string | undefined;
  let bestRound = -1;
  for (const entry of entries) {
    const match = re.exec(entry);
    if (match === null) continue;
    const round = match[1] === undefined ? 0 : Number(match[1]);
    if (round > bestRound) {
      bestRound = round;
      bestName = entry;
    }
  }
  return bestName;
}
