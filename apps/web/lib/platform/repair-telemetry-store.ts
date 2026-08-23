import type Database from "better-sqlite3";
import type { PersistenceError, Result } from "@hexagen/shared";

/**
 * Owner-scoped telemetry for the manifest repair loop (generate ->
 * deterministic-check -> repair).
 *
 * PURPOSE: this table is the measurement baseline for a future tuned "fixer"
 * model. The question it must answer is narrow and entirely statistical --
 * *for violation class X, did repair converge, in how many rounds, via which
 * path, and how long did it take* -- so that a later change can show a tuned
 * model beats today's behaviour on the classes `canAutoFix` returns false for.
 *
 * ============================================================================
 * RETENTION CONTRACT -- READ BEFORE ADDING A COLUMN
 * ============================================================================
 * Shipped UI copy promises the user that their source is not kept:
 *
 *   features/landing/domain/creation-path.ts:80,82
 *     "We shallow-clone it, scan it, and delete the clone."
 *     "Nothing is retained but the scan artifacts."
 *   features/brownfield/views/TierPickerView.tsx  `CLONE_DESCRIPTION`
 *   features/brownfield/RepoEntry/RepoEntryView.tsx:93
 *   features/brownfield/ScanProgress/GithubScanPage.tsx:208  "nothing was kept"
 *
 * A manifest is DERIVED FROM user source: its bounded-context, port and adapter
 * names are the user's own domain vocabulary, lifted out of their repository.
 * Persisting any of it -- even one context name -- breaks that promise as
 * surely as persisting a file would.
 *
 * Therefore EVERY column in both tables below is one of:
 *   - an integer count, duration, or 0/1 boolean;
 *   - a member of a CLOSED string set declared in this file;
 *   - an opaque, store-validated correlation id (see `run_id` below).
 *
 * There is no free-text column, no nullable "notes", no error message, no
 * `project_id`, and no `repo_ref`. The last two are omitted deliberately and
 * not by oversight: `saved_projects.project_id` joins to a user-authored
 * project name and `scan_records.repo_ref` is literally `owner/repo`, so
 * either one would let a reader attach a repair history to a named repository.
 * The only join key here is the opaque run id.
 *
 * The eval this table exists for does not need them. "How well does the fixer
 * do on class R03" is a question about classes, not about projects.
 *
 * RESIDUAL, stated honestly: `violations_initial` correlates loosely with
 * manifest size, and the SET of classes seen in a run says something like
 * "this manifest had a hyphen-prefixed context name". That is coarse shape,
 * not content -- nothing here can name a context, a port, an adapter, a file,
 * or a repository, and no combination of rows reconstructs YAML.
 *
 * ============================================================================
 * GRAIN -- WHY BOTH A PER-RUN AND A PER-ATTEMPT TABLE
 * ============================================================================
 * `repair_attempts` alone cannot express "abandoned": abandonment is a
 * property of the LOOP (it hit its round cap with violations still open), not
 * of any single attempt, and attributing it to the last attempt would
 * mislabel that attempt as a failure when it may have succeeded.
 *
 * `repair_runs` alone cannot express per-class success rates -- which is
 * exactly the metric a tuned fixer has to beat -- because a run mixes classes.
 *
 * So: one `repair_runs` row per repair loop carrying the terminal outcome,
 * round count and wall time; one `repair_attempts` row per (round, ordinal)
 * carrying the class and the path taken. The run row also means "rounds to
 * converge" is a column read rather than a GROUP BY, and it survives
 * attempt-row eviction under the retention cap.
 */

/**
 * Bump when the persisted row shape changes in a way an older reader would
 * misread. Same discard-don't-migrate rule as `scan_records`, and for the same
 * reason: these rows are DERIVED telemetry. Losing one costs a data point in
 * an aggregate; migrating one wrongly costs a silently skewed baseline, which
 * is the one thing a measurement table must never produce. Reads gate on
 * `schema_version = REPAIR_TELEMETRY_SCHEMA_VERSION` in SQL, so a row written
 * by a different deploy is invisible rather than half-decoded.
 *
 * Foreign-version rows are not deleted on read -- a rollback must find its own
 * rows intact -- they are reclaimed by the version-blind retention cap.
 */
export const REPAIR_TELEMETRY_SCHEMA_VERSION = 1;

/** Per-owner run cap. Bounds a table fed by a loop the user can re-trigger. */
export const MAX_REPAIR_RUNS_PER_OWNER = 500;

/** Per-run attempt cap. One pathological fixpoint loop must not fill the volume. */
export const MAX_REPAIR_ATTEMPTS_PER_RUN = 200;

/**
 * Which fixer surface produced the run.
 *
 * `client-deterministic` = the fixpoint loop in ManifestPreview.tsx driving
 * canAutoFix / applyDeterministicFix. `server-staged` = the staged pipeline's
 * Stage-7 LLM op-list repair.
 */
export const REPAIR_SURFACES = [
  "client-deterministic",
  "server-staged",
] as const;
export type RepairSurface = (typeof REPAIR_SURFACES)[number];

/**
 * Terminal state of one repair loop.
 *
 * `unfixable` and `abandoned` are NOT the same failure and collapsing them
 * would hide the more interesting one. `unfixable` means the loop reached a
 * fixpoint honestly -- every remaining violation was offered to a fixer and
 * none of them moved it -- which is the model's target set. `abandoned` means
 * the loop stopped for a reason unrelated to the violations (round cap, abort,
 * timeout, navigation away), so its remaining count is not evidence about any
 * class and must be excluded from a fixer's scorecard.
 *
 * `mixed-fixed` exists because a single run can converge via both paths, and
 * crediting it to either one alone would bias the comparison this table is
 * built to make.
 */
export const REPAIR_OUTCOMES = [
  "deterministic-fixed",
  "llm-fixed",
  "mixed-fixed",
  "unfixable",
  "abandoned",
] as const;
export type RepairOutcome = (typeof REPAIR_OUTCOMES)[number];

/** Which fixer was offered this violation. `none` = nothing was eligible. */
export const REPAIR_PATHS = ["deterministic", "llm-ops", "none"] as const;
export type RepairPath = (typeof REPAIR_PATHS)[number];

/** `ValidationItem.status`, minus `pass` -- a passing item is never repaired. */
export const REPAIR_VIOLATION_STATUSES = ["fail", "warn"] as const;
export type RepairViolationStatus = (typeof REPAIR_VIOLATION_STATUSES)[number];

/**
 * Verbatim mirror of `evaluateRepairGate`'s reason union
 * (packages/agentic-interaction/.../execute-structured-config-generation.use-case.ts).
 * Duplicated rather than imported so this store stays free of a domain-package
 * dependency; the test asserts nothing beyond the literal set, and a drift in
 * the source union surfaces as a rejected write, not a silent free-text column.
 */
export const REPAIR_GATE_REASONS = [
  "applied",
  "no-error-reduction",
  "structure-shrunk-or-context-drift",
] as const;
export type RepairGateReason = (typeof REPAIR_GATE_REASONS)[number];

/**
 * ============================================================================
 * VIOLATION CLASS -- WHY THIS IS AN ENUM AND NOT THE TITLE
 * ============================================================================
 * `canAutoFix` dispatches on `ValidationItem.title` and `.description`, both
 * free text. Storing either would break the retention contract OUTRIGHT, not
 * theoretically: manifest-view-data-parser.ts builds titles by interpolating
 * the user's own context name --
 *
 *     manifest-view-data-parser.ts:177   title: `Context Name "${name}"`
 *     manifest-view-data-parser.ts:271   title: `${name}: Zero Adapters`
 *     manifest-view-data-parser.ts:282   title: `${name}: ${n} Unconnected Ports`
 *
 * -- so a `title` column is a column of bounded-context names. Descriptions are
 * worse: they quote port and adapter names. A hash would be no better; it is
 * still a stable per-context identifier, it joins across runs, and a short
 * candidate list makes it reversible. The class must therefore be decided
 * BEFORE the write and reduced to a value drawn from the closed set below.
 *
 * Titles also drift -- they are display copy, not identifiers. Pinning the
 * class to a local enum means a copy edit changes what `classifyViolation`
 * matches, not what historical rows mean, so a baseline stays comparable
 * across the very refactors this measurement is meant to survive.
 *
 * TWO FAMILIES, ONE VOCABULARY:
 *   - `client-*` mirrors the branch structure of `canAutoFix` one-to-one,
 *     including its `false` branches, so `class -> deterministically eligible`
 *     is a total function (see `isDeterministicallyEligible`). Without that
 *     split -- e.g. one `minimum-interface-contract` class -- eligibility
 *     would depend on description text the row does not carry, and the row
 *     would be uninterpretable.
 *   - `R01`..`R18` are the staged pipeline's own rule tags. They are already
 *     stable identifiers in the codebase (`stripReconstructionArtifacts`
 *     anchors on the literal `[Rxx]` prefix) and carry no user content, so
 *     both surfaces can share one column without a schema change later.
 *
 * `unclassified` is the escape hatch for a violation neither family matches.
 * It is deliberately lossy: an unclassifiable violation is worth counting but
 * is never worth keeping its text to explain it.
 */
export const REPAIR_VIOLATION_CLASSES = [
  // -- client fixer, ineligible branches ------------------------------------
  "client-invalid-yaml",
  "client-context-name-other",
  "client-minimum-interface-contract-other",
  // -- client fixer, allow-listed branches ----------------------------------
  "client-scope-missing",
  "client-architecture-missing",
  "client-minimum-interface-contract-missing-ports",
  "client-context-name-hyphen",
  "client-yaml-tag-indicator",
  "client-zero-adapters",
  "client-unconnected-ports",
  // -- staged pipeline rule tags --------------------------------------------
  "R01",
  "R02",
  "R03",
  "R04",
  "R05",
  "R06",
  "R07",
  "R08",
  "R09",
  "R10",
  "R11",
  "R12",
  "R13",
  "R14",
  "R15",
  "R16",
  "R17",
  "R18",
  // -- neither ---------------------------------------------------------------
  "unclassified",
] as const;
export type RepairViolationClass = (typeof REPAIR_VIOLATION_CLASSES)[number];

/** The subset `canAutoFix` returns true for. Kept adjacent to the enum so the
 * two cannot drift apart unnoticed. */
const DETERMINISTICALLY_ELIGIBLE_CLASSES: ReadonlySet<string> = new Set([
  "client-scope-missing",
  "client-architecture-missing",
  "client-minimum-interface-contract-missing-ports",
  "client-context-name-hyphen",
  "client-yaml-tag-indicator",
  "client-zero-adapters",
  "client-unconnected-ports",
]);

/**
 * Total function: given a class, is the client deterministic fixer allow-listed
 * for it? `false` for every `Rxx` class -- the staged pipeline's rule tags say
 * nothing about the client allow-list, and pretending otherwise would invent
 * eligibility data the row never observed.
 */
export function isDeterministicallyEligible(
  violationClass: RepairViolationClass,
): boolean {
  return DETERMINISTICALLY_ELIGIBLE_CLASSES.has(violationClass);
}

/**
 * Reduce a validation item to a bounded class AT THE BOUNDARY, so the title and
 * description never travel any further toward the database.
 *
 * Takes a structural `{ title, description }` rather than importing
 * `ValidationItem` from `@hexagen/manifest-generation`: this keeps the platform
 * store free of a domain-package dependency, and -- more to the point -- makes
 * the narrow shape of what is read visibly smaller than the shape of what is
 * discarded (`contextName`, notably, is never touched).
 *
 * Branch order MIRRORS `canAutoFix` exactly, including the early `Invalid YAML`
 * bail. Any reordering silently reclassifies rows, so the test pins this
 * function against `canAutoFix` itself.
 */
export function classifyViolation(item: {
  title: string;
  description: string;
}): RepairViolationClass {
  const title = typeof item?.title === "string" ? item.title : "";
  const desc = typeof item?.description === "string" ? item.description : "";

  if (title === "Invalid YAML") return "client-invalid-yaml";
  if (title === "Scope Missing") return "client-scope-missing";
  if (title === "Architecture Missing") return "client-architecture-missing";
  if (title === "Minimum Interface Contract") {
    return desc.includes("missing ports")
      ? "client-minimum-interface-contract-missing-ports"
      : "client-minimum-interface-contract-other";
  }
  if (title.includes("Context Name")) {
    return desc.includes("Starts with hyphen")
      ? "client-context-name-hyphen"
      : "client-context-name-other";
  }
  if (desc.includes("YAML tag indicator") || desc.includes('contains "!"')) {
    return "client-yaml-tag-indicator";
  }
  // canAutoFix folds these into one branch; they are split here because a
  // fixer's hit rate on "no adapters at all" and on "some ports unadapted" are
  // different numbers, and the column is the only place that distinction can
  // still be made later.
  if (title.includes("Zero Adapters")) return "client-zero-adapters";
  if (title.includes("Unconnected")) return "client-unconnected-ports";
  return "unclassified";
}

/**
 * Extract the leading `[Rxx]` tag from a staged-pipeline finding.
 *
 * Anchored at the string start for the same reason `stripReconstructionArtifacts`
 * anchors: findings are always emitted as `[Rxx] ...`, and an unanchored match
 * would classify an R03 finding whose prose happens to mention R16 as R16.
 *
 * The finding string is consumed here and discarded; only the tag escapes.
 */
export function classifyFinding(finding: string): RepairViolationClass {
  const match = /^\[(R\d{2})\]/.exec(
    typeof finding === "string" ? finding : "",
  );
  const tag = match?.[1];
  if (tag !== undefined && isRepairViolationClass(tag)) return tag;
  return "unclassified";
}

function isRepairViolationClass(value: unknown): value is RepairViolationClass {
  return (
    typeof value === "string" &&
    (REPAIR_VIOLATION_CLASSES as readonly string[]).includes(value)
  );
}

function isRepairSurface(value: unknown): value is RepairSurface {
  return (
    typeof value === "string" &&
    (REPAIR_SURFACES as readonly string[]).includes(value)
  );
}

function isRepairOutcome(value: unknown): value is RepairOutcome {
  return (
    typeof value === "string" &&
    (REPAIR_OUTCOMES as readonly string[]).includes(value)
  );
}

function isRepairPath(value: unknown): value is RepairPath {
  return (
    typeof value === "string" &&
    (REPAIR_PATHS as readonly string[]).includes(value)
  );
}

function isRepairViolationStatus(
  value: unknown,
): value is RepairViolationStatus {
  return (
    typeof value === "string" &&
    (REPAIR_VIOLATION_STATUSES as readonly string[]).includes(value)
  );
}

function isRepairGateReason(value: unknown): value is RepairGateReason {
  return (
    typeof value === "string" &&
    (REPAIR_GATE_REASONS as readonly string[]).includes(value)
  );
}

/**
 * A correlation id must be opaque, because a caller could otherwise pass a repo
 * slug or a project name as one and quietly turn the only string column left
 * into an identifying column. Restricting it to a v4-shaped UUID is checkable
 * at the write, so the guarantee is enforced here rather than promised in a
 * call-site comment. `crypto.randomUUID()` satisfies it; `"acme/billing"` does
 * not, and is rejected rather than hashed -- hashing would accept the mistake
 * and keep a stable per-repo key.
 */
const OPAQUE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface RecordRepairAttemptInput {
  /** 1-based round of the repair loop. */
  readonly round: number;
  /** 0-based ordinal within the round; the client loop breaks after the first
   * applied fix, but a server op-list applies several. */
  readonly seq: number;
  readonly violationClass: RepairViolationClass;
  readonly violationStatus: RepairViolationStatus;
  readonly path: RepairPath;
  /**
   * `canAutoFix`'s verdict, recorded INDEPENDENTLY of whether a fix then
   * landed. This pair is the whole point of the table:
   *   eligible=1, applied=0 -> allow-listed but `applyDeterministicFix`
   *                            returned null; today this is silent, and it is
   *                            the regression class a tuned model must not
   *                            inherit.
   *   eligible=0            -> the fall-through set; the model's actual target.
   */
  readonly eligible: boolean;
  readonly applied: boolean;
  /**
   * Whether the produced YAML actually DIFFERED from the input. The client loop
   * gates its `changed` flag on `patched !== yaml`, so a fixer that returns an
   * identical document is a no-op the `applied` flag alone would score as a
   * success.
   */
  readonly changedYaml: boolean;
  readonly durationMs: number;
  /** Server op-list counts. Null on the client path, which has no op-list. */
  readonly opsProposed?: number | null;
  readonly opsApplied?: number | null;
  readonly opsSkipped?: number | null;
  /** `evaluateRepairGate` verdict. Null on the client path, which has no gate. */
  readonly gateReason?: RepairGateReason | null;
}

export interface RecordRepairRunInput {
  /** Opaque correlation id; must satisfy OPAQUE_ID. Defaults to a fresh UUID. */
  readonly runId?: string;
  readonly surface: RepairSurface;
  readonly outcome: RepairOutcome;
  /** Rounds the loop executed, whether or not any of them fixed anything. */
  readonly rounds: number;
  readonly violationsInitial: number;
  readonly violationsRemaining: number;
  /** Wall time for the whole loop, not the sum of the attempts. */
  readonly durationMs: number;
  readonly attempts?: readonly RecordRepairAttemptInput[];
  readonly now?: number;
}

export interface RepairAttemptRecord {
  readonly id: string;
  readonly runId: string;
  readonly round: number;
  readonly seq: number;
  readonly violationClass: RepairViolationClass;
  readonly violationStatus: RepairViolationStatus;
  readonly path: RepairPath;
  readonly eligible: boolean;
  readonly applied: boolean;
  readonly changedYaml: boolean;
  readonly durationMs: number;
  readonly opsProposed: number | null;
  readonly opsApplied: number | null;
  readonly opsSkipped: number | null;
  readonly gateReason: RepairGateReason | null;
  readonly createdAt: number;
}

export interface RepairRunRecord {
  readonly id: string;
  readonly runId: string;
  readonly surface: RepairSurface;
  readonly outcome: RepairOutcome;
  readonly rounds: number;
  readonly violationsInitial: number;
  readonly violationsRemaining: number;
  readonly attemptsTotal: number;
  readonly attemptsApplied: number;
  readonly durationMs: number;
  readonly createdAt: number;
}

/** Aggregate row for the eval: one line per violation class. */
export interface RepairClassStat {
  readonly violationClass: RepairViolationClass;
  readonly attempts: number;
  readonly eligible: number;
  readonly applied: number;
  readonly medianDurationMs: number;
}

interface RepairRunRow {
  id: string;
  run_id: string;
  surface: string;
  outcome: string;
  rounds: number;
  violations_initial: number;
  violations_remaining: number;
  attempts_total: number;
  attempts_applied: number;
  duration_ms: number;
  created_at: number;
}

interface RepairAttemptRow {
  id: string;
  run_id: string;
  round: number;
  seq: number;
  violation_class: string;
  violation_status: string;
  path: string;
  eligible: number;
  applied: number;
  changed_yaml: number;
  duration_ms: number;
  ops_proposed: number | null;
  ops_applied: number | null;
  ops_skipped: number | null;
  gate_reason: string | null;
  created_at: number;
}

const RUN_COLUMNS = `
  id, run_id, surface, outcome, rounds, violations_initial,
  violations_remaining, attempts_total, attempts_applied, duration_ms,
  created_at
`;

const ATTEMPT_COLUMNS = `
  id, run_id, round, seq, violation_class, violation_status, path, eligible,
  applied, changed_yaml, duration_ms, ops_proposed, ops_applied, ops_skipped,
  gate_reason, created_at
`;

/**
 * Rejected input surfaces as `Unknown`, not a dedicated `Invalid` kind:
 * `PersistenceError` lives in the shared kernel (packages/shared) and adding a
 * member is outside this packet's scope fence. Same precedent and same caveat
 * as scan-records-store.ts.
 *
 * The message names the FIELD and never echoes the rejected value -- an error
 * string that quoted a bad `runId` would put the exact content this store
 * refuses to keep into a log line, and error strings travel further than rows.
 */
function rejected(message: string): Result<never, PersistenceError> {
  return { success: false, error: { kind: "Unknown", message } };
}

/** Counts cross a route boundary, so coerce rather than trust. */
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function nullableCount(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.trunc(value));
}

function clampLimit(limit: number | undefined, fallback: number): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(1, Math.trunc(limit)), MAX_REPAIR_RUNS_PER_OWNER);
}

function runRowToRecord(row: RepairRunRow): RepairRunRecord | null {
  // A stored enum that no longer parses is dropped, never coerced to a
  // default: a wrong-but-plausible `outcome` is a silently skewed baseline,
  // which is the one failure a measurement table cannot afford.
  if (!isRepairSurface(row.surface)) return null;
  if (!isRepairOutcome(row.outcome)) return null;
  return {
    id: row.id,
    runId: row.run_id,
    surface: row.surface,
    outcome: row.outcome,
    rounds: row.rounds,
    violationsInitial: row.violations_initial,
    violationsRemaining: row.violations_remaining,
    attemptsTotal: row.attempts_total,
    attemptsApplied: row.attempts_applied,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  };
}

function attemptRowToRecord(row: RepairAttemptRow): RepairAttemptRecord | null {
  if (!isRepairViolationClass(row.violation_class)) return null;
  if (!isRepairViolationStatus(row.violation_status)) return null;
  if (!isRepairPath(row.path)) return null;
  let gateReason: RepairGateReason | null = null;
  if (row.gate_reason !== null) {
    if (!isRepairGateReason(row.gate_reason)) return null;
    gateReason = row.gate_reason;
  }
  return {
    id: row.id,
    runId: row.run_id,
    round: row.round,
    seq: row.seq,
    violationClass: row.violation_class,
    violationStatus: row.violation_status,
    path: row.path,
    eligible: row.eligible === 1,
    applied: row.applied === 1,
    changedYaml: row.changed_yaml === 1,
    durationMs: row.duration_ms,
    opsProposed: row.ops_proposed,
    opsApplied: row.ops_applied,
    opsSkipped: row.ops_skipped,
    gateReason,
    createdAt: row.created_at,
  };
}

export interface RepairTelemetryStore {
  /**
   * Write one repair loop and its attempts as a single transaction. Attempts
   * are never written without their run: a half-written run is an attempt set
   * whose terminal outcome is unknown, i.e. rows that can only be counted
   * wrongly.
   */
  record(
    input: RecordRepairRunInput,
  ): Result<RepairRunRecord, PersistenceError>;
  /** Newest first. */
  listRuns(options?: {
    surface?: RepairSurface;
    limit?: number;
  }): Result<RepairRunRecord[], PersistenceError>;
  /** Attempts for one run, in loop order. */
  listAttempts(runId: string): Result<RepairAttemptRecord[], PersistenceError>;
  /** The eval read: per-class attempt / eligibility / success counts. */
  classStats(options?: {
    surface?: RepairSurface;
  }): Result<RepairClassStat[], PersistenceError>;
}

export function createRepairTelemetryStore(
  db: Database.Database,
  ownerId: string,
): RepairTelemetryStore {
  const insertRun = db.prepare(`
    INSERT INTO repair_runs (
      id, owner_id, schema_version, run_id, surface, outcome, rounds,
      violations_initial, violations_remaining, attempts_total,
      attempts_applied, duration_ms, created_at
    ) VALUES (
      @id, @owner_id, @schema_version, @run_id, @surface, @outcome, @rounds,
      @violations_initial, @violations_remaining, @attempts_total,
      @attempts_applied, @duration_ms, @created_at
    )
    ON CONFLICT(owner_id, run_id) DO UPDATE SET
      surface = excluded.surface,
      outcome = excluded.outcome,
      rounds = excluded.rounds,
      violations_initial = excluded.violations_initial,
      violations_remaining = excluded.violations_remaining,
      attempts_total = excluded.attempts_total,
      attempts_applied = excluded.attempts_applied,
      duration_ms = excluded.duration_ms,
      schema_version = excluded.schema_version,
      created_at = excluded.created_at
    RETURNING ${RUN_COLUMNS}
  `);

  const insertAttempt = db.prepare(`
    INSERT INTO repair_attempts (
      id, owner_id, schema_version, run_id, round, seq, violation_class,
      violation_status, path, eligible, applied, changed_yaml, duration_ms,
      ops_proposed, ops_applied, ops_skipped, gate_reason, created_at
    ) VALUES (
      @id, @owner_id, @schema_version, @run_id, @round, @seq, @violation_class,
      @violation_status, @path, @eligible, @applied, @changed_yaml,
      @duration_ms, @ops_proposed, @ops_applied, @ops_skipped, @gate_reason,
      @created_at
    )
    ON CONFLICT(owner_id, run_id, round, seq) DO UPDATE SET
      violation_class = excluded.violation_class,
      violation_status = excluded.violation_status,
      path = excluded.path,
      eligible = excluded.eligible,
      applied = excluded.applied,
      changed_yaml = excluded.changed_yaml,
      duration_ms = excluded.duration_ms,
      ops_proposed = excluded.ops_proposed,
      ops_applied = excluded.ops_applied,
      ops_skipped = excluded.ops_skipped,
      gate_reason = excluded.gate_reason,
      schema_version = excluded.schema_version,
      created_at = excluded.created_at
  `);

  // A re-recorded run replaces its attempt set wholesale. Upserting attempt
  // rows alone would leave orphans from a longer previous loop, and a run whose
  // attempts_total disagrees with its attempt count is unusable evidence.
  const deleteAttemptsForRun = db.prepare(
    "DELETE FROM repair_attempts WHERE owner_id = ? AND run_id = ?",
  );

  // Retention is version-BLIND, like scan_records: gating eviction on
  // schema_version would make foreign-version rows immortal and the table would
  // grow forever behind an invisible wall.
  const selectEvictableRuns = db.prepare(`
    SELECT run_id FROM repair_runs
     WHERE owner_id = @owner_id
     ORDER BY created_at DESC, rowid DESC
     LIMIT -1 OFFSET @keep
  `);
  const deleteRunByRunId = db.prepare(
    "DELETE FROM repair_runs WHERE owner_id = ? AND run_id = ?",
  );

  const selectRuns = db.prepare(`
    SELECT ${RUN_COLUMNS} FROM repair_runs
     WHERE owner_id = @owner_id
       AND schema_version = @schema_version
       AND (@surface IS NULL OR surface = @surface)
     ORDER BY created_at DESC, rowid DESC
     LIMIT @limit
  `);

  const selectAttempts = db.prepare(`
    SELECT ${ATTEMPT_COLUMNS} FROM repair_attempts
     WHERE owner_id = @owner_id
       AND run_id = @run_id
       AND schema_version = @schema_version
     ORDER BY round ASC, seq ASC
  `);

  // Median, not mean: one 30s LLM round otherwise swamps a hundred
  // sub-millisecond deterministic fixes and the class average stops describing
  // anything.
  //
  // sqlite has no percentile function, so the median is the lower-middle order
  // statistic, picked with a window function. An earlier revision used a
  // correlated `LIMIT 1 OFFSET (SELECT COUNT(*)/2 ...)`, which does not
  // prepare: the OFFSET subquery sits two levels below the outer GROUP BY and
  // sqlite will not correlate that deep ("no such column: a.owner_id").
  //
  // `rn = (n + 1) / 2` is integer division, so n=1,2 -> 1; n=3,4 -> 2. Even
  // counts resolve DOWN, which is what "lower-middle" means and keeps the
  // reported value an observed duration rather than an interpolated one.
  const selectClassStats = db.prepare(`
    WITH scoped AS (
      SELECT
        a.violation_class AS violation_class,
        a.eligible AS eligible,
        a.applied AS applied,
        a.duration_ms AS duration_ms,
        ROW_NUMBER() OVER (
          PARTITION BY a.violation_class ORDER BY a.duration_ms ASC
        ) AS rn,
        COUNT(*) OVER (PARTITION BY a.violation_class) AS n
      FROM repair_attempts a
      JOIN repair_runs r ON r.owner_id = a.owner_id AND r.run_id = a.run_id
       WHERE a.owner_id = @owner_id
         AND a.schema_version = @schema_version
         AND (@surface IS NULL OR r.surface = @surface)
    )
    SELECT
      violation_class,
      COUNT(*) AS attempts,
      SUM(eligible) AS eligible,
      SUM(applied) AS applied,
      MAX(CASE WHEN rn = (n + 1) / 2 THEN duration_ms END)
        AS median_duration_ms
    FROM scoped
    GROUP BY violation_class
    ORDER BY attempts DESC, violation_class ASC
  `);

  interface RunWriteParams {
    run: Record<string, string | number | null>;
    attempts: Array<Record<string, string | number | null>>;
  }

  const writeWithRetention = db.transaction(
    (params: RunWriteParams): RepairRunRow => {
      // The STORED row, not the input: on the upsert path the conflicting row
      // keeps its original `id`, so returning the freshly minted one would hand
      // the caller a primary key that is not in the table.
      const stored = insertRun.get(params.run) as RepairRunRow;
      deleteAttemptsForRun.run(ownerId, params.run.run_id as string);
      for (const attempt of params.attempts) {
        insertAttempt.run(attempt);
      }
      const evictable = selectEvictableRuns.all({
        owner_id: ownerId,
        keep: MAX_REPAIR_RUNS_PER_OWNER,
      }) as Array<{ run_id: string }>;
      for (const row of evictable) {
        // Attempts first: a run row deleted while its attempts survive leaves
        // rows the class-stats join silently drops, i.e. a table that looks
        // smaller than it is.
        deleteAttemptsForRun.run(ownerId, row.run_id);
        deleteRunByRunId.run(ownerId, row.run_id);
      }
      return stored;
    },
  );

  return {
    record(input) {
      if (!isRepairSurface(input?.surface)) {
        return rejected("surface is not a known repair surface");
      }
      if (!isRepairOutcome(input?.outcome)) {
        return rejected("outcome is not a known repair outcome");
      }
      const runId = input.runId ?? crypto.randomUUID();
      if (!OPAQUE_ID.test(runId)) {
        // Deliberately does not echo runId -- see `rejected`.
        return rejected("runId must be an opaque UUID");
      }

      const attempts = Array.isArray(input.attempts) ? input.attempts : [];
      if (attempts.length > MAX_REPAIR_ATTEMPTS_PER_RUN) {
        return rejected(
          `attempts exceed ${MAX_REPAIR_ATTEMPTS_PER_RUN} per run`,
        );
      }

      const now = input.now ?? Date.now();
      const seen = new Set<string>();
      const attemptParams: Array<Record<string, string | number | null>> = [];
      for (const attempt of attempts) {
        if (!isRepairViolationClass(attempt?.violationClass)) {
          return rejected("attempt violationClass is not a known class");
        }
        if (!isRepairViolationStatus(attempt?.violationStatus)) {
          return rejected("attempt violationStatus is not fail or warn");
        }
        if (!isRepairPath(attempt?.path)) {
          return rejected("attempt path is not a known repair path");
        }
        const gateReason = attempt.gateReason ?? null;
        if (gateReason !== null && !isRepairGateReason(gateReason)) {
          return rejected("attempt gateReason is not a known gate reason");
        }
        const round = count(attempt.round);
        const seq = count(attempt.seq);
        // (round, seq) is the attempt's identity within a run and carries the
        // unique index. A duplicate would upsert over its twin, so the write
        // would silently lose an attempt rather than fail loudly.
        const key = `${round}:${seq}`;
        if (seen.has(key)) {
          return rejected("attempts contain a duplicate round/seq pair");
        }
        seen.add(key);
        attemptParams.push({
          id: crypto.randomUUID(),
          owner_id: ownerId,
          schema_version: REPAIR_TELEMETRY_SCHEMA_VERSION,
          run_id: runId,
          round,
          seq,
          violation_class: attempt.violationClass,
          violation_status: attempt.violationStatus,
          path: attempt.path,
          eligible: attempt.eligible === true ? 1 : 0,
          applied: attempt.applied === true ? 1 : 0,
          changed_yaml: attempt.changedYaml === true ? 1 : 0,
          duration_ms: count(attempt.durationMs),
          ops_proposed: nullableCount(attempt.opsProposed),
          ops_applied: nullableCount(attempt.opsApplied),
          ops_skipped: nullableCount(attempt.opsSkipped),
          gate_reason: gateReason,
          created_at: now,
        });
      }

      const pending: RepairRunRecord = {
        id: crypto.randomUUID(),
        runId,
        surface: input.surface,
        outcome: input.outcome,
        rounds: count(input.rounds),
        violationsInitial: count(input.violationsInitial),
        violationsRemaining: count(input.violationsRemaining),
        attemptsTotal: attemptParams.length,
        // Counted here rather than taken from the caller: a caller-supplied
        // success count that disagrees with the attempt rows would make the
        // two grains contradict each other, and there would be no way to tell
        // which one lied.
        attemptsApplied: attemptParams.filter((a) => a.applied === 1).length,
        durationMs: count(input.durationMs),
        createdAt: now,
      };

      let stored: RepairRunRow;
      try {
        stored = writeWithRetention({
          run: {
            id: pending.id,
            owner_id: ownerId,
            schema_version: REPAIR_TELEMETRY_SCHEMA_VERSION,
            run_id: pending.runId,
            surface: pending.surface,
            outcome: pending.outcome,
            rounds: pending.rounds,
            violations_initial: pending.violationsInitial,
            violations_remaining: pending.violationsRemaining,
            attempts_total: pending.attemptsTotal,
            attempts_applied: pending.attemptsApplied,
            duration_ms: pending.durationMs,
            created_at: pending.createdAt,
          },
          attempts: attemptParams,
        });
      } catch (cause) {
        return {
          success: false,
          error: {
            kind: "Unknown",
            message: "Failed to persist repair telemetry",
            cause,
          },
        };
      }
      const record = runRowToRecord(stored);
      if (record === null) {
        // Unreachable in practice -- the enums were validated above -- but a
        // returned record that does not match the stored row is exactly the
        // silent skew this table cannot afford, so it fails instead.
        return rejected("Stored repair run did not decode");
      }
      return { success: true, value: record };
    },

    listRuns(options = {}) {
      const rows = selectRuns.all({
        owner_id: ownerId,
        schema_version: REPAIR_TELEMETRY_SCHEMA_VERSION,
        surface: options.surface ?? null,
        limit: clampLimit(options.limit, 100),
      }) as RepairRunRow[];
      const records: RepairRunRecord[] = [];
      for (const row of rows) {
        const record = runRowToRecord(row);
        if (record !== null) records.push(record);
      }
      return { success: true, value: records };
    },

    listAttempts(runId) {
      if (!OPAQUE_ID.test(typeof runId === "string" ? runId : "")) {
        return rejected("runId must be an opaque UUID");
      }
      const rows = selectAttempts.all({
        owner_id: ownerId,
        run_id: runId,
        schema_version: REPAIR_TELEMETRY_SCHEMA_VERSION,
      }) as RepairAttemptRow[];
      const records: RepairAttemptRecord[] = [];
      for (const row of rows) {
        const record = attemptRowToRecord(row);
        if (record !== null) records.push(record);
      }
      return { success: true, value: records };
    },

    classStats(options = {}) {
      const rows = selectClassStats.all({
        owner_id: ownerId,
        schema_version: REPAIR_TELEMETRY_SCHEMA_VERSION,
        surface: options.surface ?? null,
      }) as Array<{
        violation_class: string;
        attempts: number;
        eligible: number;
        applied: number;
        median_duration_ms: number | null;
      }>;
      const stats: RepairClassStat[] = [];
      for (const row of rows) {
        if (!isRepairViolationClass(row.violation_class)) continue;
        stats.push({
          violationClass: row.violation_class,
          attempts: row.attempts,
          eligible: row.eligible,
          applied: row.applied,
          medianDurationMs: row.median_duration_ms ?? 0,
        });
      }
      return { success: true, value: stats };
    },
  };
}
