import type Database from "better-sqlite3";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { PersistenceError, Result } from "@hexagen/shared";
import type { ScanVerdict } from "@/lib/project-scan/types";
import {
  MAX_PROJECT_NAME_CHARS,
  MAX_SCAN_ERROR_CHARS,
  MAX_SCAN_LAYOUT_EXCERPT_CHARS,
  MAX_SCAN_REPORT_CHARS,
} from "@/lib/project-scan/limits";

/**
 * Owner-scoped scan history on `platform.db` (F-13).
 *
 * This file is a ROW store and performs no filesystem I/O. Artifact bytes are
 * written to the /data volume by the caller; the row keeps only the path and
 * the size. That split is deliberate: it keeps the store pure (and so testable
 * against `:memory:` with no temp dirs) and makes artifact lifecycle --
 * including cleanup after retention eviction -- explicit at the call site
 * instead of a hidden side effect of an INSERT.
 *
 * Not a variant of `saved_projects`: `savedProjectBodySchema` requires
 * `formState` + `manifestYaml`, neither of which a scan produces.
 */

/**
 * Bump when the persisted row shape changes in a way an older reader would
 * misread.
 *
 * VERSIONING DECISION -- discard, do not migrate.
 *
 * Reads gate on `schema_version = SCAN_RECORD_SCHEMA_VERSION` in SQL, so a row
 * written by a different deploy is simply not visible: never half-decoded,
 * never coerced, never partially applied to a `ScanRecord`. The same rule
 * applies at blob granularity -- a `findings_sample` payload that does not
 * match the expected shape drops the whole row from a listing rather than
 * yielding a record with an empty sample that reads as "nothing found".
 *
 * Why discard here when `saved_projects` in platform-db.ts gets a real table
 * migration: saved projects are user-authored and irreplaceable, so losing one
 * is data loss. A scan record is DERIVED -- every field is reproducible by
 * re-running the scan -- so the cost of dropping it is one re-scan, while the
 * cost of a subtly wrong migration is a findings count that silently
 * understates a repo's debt. Cheap to lose, expensive to get wrong: discard.
 *
 * Foreign-version rows are NOT deleted on read. A rollback to the previous
 * deploy must find its own rows intact, and a read path that deletes is a read
 * path that can destroy data during a five-minute rollback window. They are
 * reclaimed instead by the version-blind retention cap below.
 */
export const SCAN_RECORD_SCHEMA_VERSION = 1;

/** Tier A = artifacts uploaded from a local scan; Tier B = server-side scan. */
export const SCAN_TIERS = ["A", "B"] as const;
export type ScanTier = (typeof SCAN_TIERS)[number];

const SCAN_VERDICTS: readonly ScanVerdict[] = [
  "pass",
  "violations",
  "could-not-run",
];

/**
 * Inline findings are a SAMPLE, not the set. The full list belongs in the
 * volume-backed artifact. 50 entries render a review screen's first page;
 * `findingsTotal` carries the real count.
 */
export const MAX_INLINE_FINDING_ENTRIES = 50;

/** Per-field clip inside a sampled finding. Rule ids and paths are short. */
export const MAX_FINDING_FIELD_CHARS = 300;

/** `owner/repo#a-long-branch-name` needs room, but not unbounded room. */
export const MAX_REPO_REF_CHARS = 400;

/** Per-owner row cap. Bounds a table fed by a repeatable, metered route. */
export const MAX_SCAN_RECORDS_PER_OWNER = 200;

/** Sanity bound on a caller-supplied artifact size (32 MiB scan zip + slack). */
export const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;

export interface ScanFindingCounts {
  readonly fresh: number;
  readonly baselined: number;
  readonly stale: number;
  readonly expired: number;
}

export interface ScanFindingEntry {
  readonly rule: string;
  readonly file: string;
  readonly specifier: string;
}

export interface ScanArtifactRef {
  readonly path: string;
  readonly bytes: number;
}

export interface ScanRecord {
  readonly id: string;
  readonly projectName: string;
  /** `owner/repo` or `owner/repo#ref`; null for a zip upload with no origin. */
  readonly repoRef: string | null;
  readonly tier: ScanTier;
  readonly verdict: ScanVerdict;
  readonly exitCode: number | null;
  readonly filesScanned: number | null;
  readonly findings: ScanFindingCounts;
  readonly findingsSample: readonly ScanFindingEntry[];
  readonly findingsTotal: number;
  readonly layoutExcerpt: string | null;
  readonly reportMarkdown: string | null;
  readonly errorMessage: string | null;
  readonly artifact: ScanArtifactRef | null;
  readonly createdAt: number;
}

export interface RecordScanInput {
  readonly id?: string;
  readonly projectName: string;
  readonly repoRef?: string | null;
  readonly tier: ScanTier;
  readonly verdict: ScanVerdict;
  readonly exitCode?: number | null;
  readonly filesScanned?: number | null;
  readonly findings?: Partial<ScanFindingCounts>;
  readonly findingsSample?: readonly ScanFindingEntry[];
  readonly findingsTotal?: number;
  readonly layoutExcerpt?: string | null;
  readonly reportMarkdown?: string | null;
  readonly errorMessage?: string | null;
  readonly artifact?: ScanArtifactRef | null;
  readonly now?: number;
}

export interface RecordScanOutcome {
  readonly record: ScanRecord;
  /**
   * Artifact paths belonging to rows evicted by the per-owner retention cap.
   * The caller owns unlinking them -- this store never touches the filesystem.
   * Empty on almost every write.
   */
  readonly evictedArtifactPaths: readonly string[];
}

/** Sparkline input for the report screen. Read without touching the blob. */
export interface ScanTrendPoint {
  readonly id: string;
  readonly createdAt: number;
  readonly verdict: ScanVerdict;
  readonly fresh: number;
  readonly baselined: number;
}

export interface ScanRecordsStore {
  record(input: RecordScanInput): Result<RecordScanOutcome, PersistenceError>;
  /** Newest first. */
  list(options?: {
    repoRef?: string;
    limit?: number;
  }): Result<ScanRecord[], PersistenceError>;
  get(id: string): Result<ScanRecord, PersistenceError>;
  /** The newest `limit` scans, returned oldest-first for a left-to-right chart. */
  trend(options?: {
    repoRef?: string;
    limit?: number;
  }): Result<ScanTrendPoint[], PersistenceError>;
}

interface ScanRecordRow {
  id: string;
  project_name: string;
  repo_ref: string | null;
  tier: string;
  verdict: string;
  exit_code: number | null;
  files_scanned: number | null;
  findings_fresh: number;
  findings_baselined: number;
  findings_stale: number;
  findings_expired: number;
  layout_excerpt: string | null;
  report_markdown: string | null;
  error_message: string | null;
  findings_sample: string;
  artifact_path: string | null;
  artifact_bytes: number | null;
  created_at: number;
}

interface ScanRecordInsertParams {
  id: string;
  owner_id: string;
  schema_version: number;
  project_name: string;
  repo_ref: string | null;
  tier: string;
  verdict: string;
  exit_code: number | null;
  files_scanned: number | null;
  findings_fresh: number;
  findings_baselined: number;
  findings_stale: number;
  findings_expired: number;
  layout_excerpt: string | null;
  report_markdown: string | null;
  error_message: string | null;
  findings_sample: string;
  artifact_path: string | null;
  artifact_bytes: number | null;
  created_at: number;
}

interface ScanTrendRow {
  id: string;
  created_at: number;
  verdict: string;
  findings_fresh: number;
  findings_baselined: number;
}

const RECORD_COLUMNS = `
  id, project_name, repo_ref, tier, verdict, exit_code, files_scanned,
  findings_fresh, findings_baselined, findings_stale, findings_expired,
  layout_excerpt, report_markdown, error_message, findings_sample,
  artifact_path, artifact_bytes, created_at
`;

function persistError(
  kind: PersistenceError["kind"],
  message: string,
  cause?: unknown,
): PersistenceError {
  if (
    kind === "SerializationFailed" ||
    kind === "DeserializationFailed" ||
    kind === "Unknown"
  ) {
    return { kind, message, cause };
  }
  return { kind, message };
}

/**
 * Rejected input surfaces as `Unknown`, not a dedicated `Invalid` kind:
 * `PersistenceError` lives in the shared kernel (packages/shared) and adding a
 * member is outside this packet's scope fence, so the message carries the
 * specificity instead. Flagged for a later kernel change.
 */
function rejected(message: string): Result<never, PersistenceError> {
  return { success: false, error: persistError("Unknown", message) };
}

function clip(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string") return null;
  return value.length > max ? value.slice(0, max) : value;
}

/** Counts arrive from a CLI envelope, so coerce rather than trust. */
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function nullableInt(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.trunc(value);
}

function clampLimit(limit: number | undefined, fallback: number): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(1, Math.trunc(limit)), MAX_SCAN_RECORDS_PER_OWNER);
}

/**
 * Path math only -- no `fs`, no symlink resolution. Rejects `..` traversal and
 * any absolute path outside the artifacts root; it does NOT prove the final
 * path is not a symlink pointing off the volume. Callers are expected to
 * derive paths with `scanArtifactPath` rather than accept one from a request
 * body, and this is the belt to that suspenders.
 */
export function isPathInside(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** Strip everything a path segment has no business containing. */
/**
 * The characters a path segment may contain. Matches SCAN_ID_PATTERN in
 * app/api/projects/install-gate/route.ts, which ALLOWS `.` -- an earlier
 * revision stripped it, so `scan.1` and `scan1` both became `scan1.zip` and
 * two distinct scans silently shared one artifact file.
 */
const SEGMENT_CHARS = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Reject a segment rather than sanitising it.
 *
 * Sanitising is what caused the collision: any two ids differing only in
 * stripped characters map to one path. Rejecting keeps the mapping injective,
 * so a stored path always identifies exactly one scan.
 *
 * Dot segments are refused BY NAME, not by character class. Allowing `.` back
 * into the charset re-admits `..`, and a `..` segment is traversal regardless
 * of how the rest of the string looks -- so `.`, `..`, and any segment
 * containing `..` are rejected outright.
 */
/** Non-throwing variant for validation paths that must return a Result. */
function assertSafeSegmentOrNull(value: string): string | null {
  if (!SEGMENT_CHARS.test(value)) return null;
  if (value === "." || value === ".." || value.includes("..")) return null;
  return value;
}

function assertSafeSegment(value: string, label: string): string {
  if (!SEGMENT_CHARS.test(value)) {
    throw new Error(
      `scanArtifactPath: ${label} must match ${String(SEGMENT_CHARS)}`,
    );
  }
  if (value === "." || value === ".." || value.includes("..")) {
    throw new Error(`scanArtifactPath: ${label} must not be a dot segment`);
  }
  return value;
}

/**
 * Derive the artifact path for a scan. Traversal-proof by construction: both
 * segments are reduced to `[A-Za-z0-9_-]`, so no caller-supplied string can
 * escape `root` even if it arrived straight from a request body.
 */
export function scanArtifactPath(
  root: string,
  ownerId: string,
  scanId: string,
  extension = "zip",
): string {
  const owner = assertSafeSegment(ownerId, "owner id");
  const scan = assertSafeSegment(scanId, "scan id");
  const ext = assertSafeSegment(extension, "extension");
  return join(resolve(root), owner, `${scan}.${ext}`);
}

interface FindingsBlob {
  entries: ScanFindingEntry[];
  total: number;
}

function isFindingEntry(value: unknown): value is ScanFindingEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.rule === "string" &&
    typeof entry.file === "string" &&
    typeof entry.specifier === "string"
  );
}

/**
 * Returns null on ANY deviation from the expected shape. Callers drop the row
 * rather than substituting an empty sample -- an empty sample renders as
 * "nothing found", the one wrong answer a conformance product must never give.
 */
function parseFindingsBlob(raw: string): FindingsBlob | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const blob = parsed as Record<string, unknown>;
  if (!Array.isArray(blob.entries)) return null;
  if (typeof blob.total !== "number" || !Number.isFinite(blob.total)) {
    return null;
  }
  if (!blob.entries.every(isFindingEntry)) return null;
  return {
    entries: blob.entries as ScanFindingEntry[],
    total: Math.max(0, Math.trunc(blob.total)),
  };
}

function isScanTier(value: unknown): value is ScanTier {
  return (
    typeof value === "string" && (SCAN_TIERS as readonly string[]).includes(value)
  );
}

function isScanVerdict(value: unknown): value is ScanVerdict {
  return (
    typeof value === "string" &&
    (SCAN_VERDICTS as readonly string[]).includes(value)
  );
}

function rowToRecord(row: ScanRecordRow): ScanRecord | null {
  // A stored enum that no longer parses is the same class of problem as a
  // stale schema_version: drop the row, never coerce it to a default.
  if (!isScanTier(row.tier)) return null;
  if (!isScanVerdict(row.verdict)) return null;
  const blob = parseFindingsBlob(row.findings_sample);
  if (blob === null) return null;
  return {
    id: row.id,
    projectName: row.project_name,
    repoRef: row.repo_ref,
    tier: row.tier,
    verdict: row.verdict,
    exitCode: row.exit_code,
    filesScanned: row.files_scanned,
    findings: {
      fresh: row.findings_fresh,
      baselined: row.findings_baselined,
      stale: row.findings_stale,
      expired: row.findings_expired,
    },
    findingsSample: blob.entries,
    findingsTotal: blob.total,
    layoutExcerpt: row.layout_excerpt,
    reportMarkdown: row.report_markdown,
    errorMessage: row.error_message,
    artifact:
      row.artifact_path === null || row.artifact_bytes === null
        ? null
        : { path: row.artifact_path, bytes: row.artifact_bytes },
    createdAt: row.created_at,
  };
}

export function createScanRecordsStore(
  db: Database.Database,
  ownerId: string,
  artifactsRoot: string,
): ScanRecordsStore {
  const insert = db.prepare(`
    INSERT INTO scan_records (
      id, owner_id, schema_version, project_name, repo_ref, tier, verdict,
      exit_code, files_scanned, findings_fresh, findings_baselined,
      findings_stale, findings_expired, layout_excerpt, report_markdown,
      error_message, findings_sample, artifact_path, artifact_bytes, created_at
    ) VALUES (
      @id, @owner_id, @schema_version, @project_name, @repo_ref, @tier, @verdict,
      @exit_code, @files_scanned, @findings_fresh, @findings_baselined,
      @findings_stale, @findings_expired, @layout_excerpt, @report_markdown,
      @error_message, @findings_sample, @artifact_path, @artifact_bytes,
      @created_at
    )
  `);

  // Retention is version-BLIND on purpose. Gating eviction on schema_version
  // would make foreign-version rows immortal, so a version bump would leave the
  // table growing forever behind an invisible wall.
  const selectEvictable = db.prepare(`
    SELECT id, artifact_path FROM scan_records
     WHERE owner_id = @owner_id
     ORDER BY created_at DESC, rowid DESC
     LIMIT -1 OFFSET @keep
  `);
  const deleteById = db.prepare(
    "DELETE FROM scan_records WHERE owner_id = ? AND id = ?",
  );

  const selectMany = db.prepare(`
    SELECT ${RECORD_COLUMNS} FROM scan_records
     WHERE owner_id = @owner_id
       AND schema_version = @schema_version
       AND (@repo_ref IS NULL OR repo_ref = @repo_ref)
     ORDER BY created_at DESC, rowid DESC
     LIMIT @limit
  `);
  const selectOne = db.prepare(`
    SELECT ${RECORD_COLUMNS} FROM scan_records
     WHERE owner_id = @owner_id
       AND id = @id
       AND schema_version = @schema_version
  `);
  // rowid must be SELECTED here, aliased: the outer query reads from a
  // subquery result, which is not a table and therefore has no rowid of its
  // own. Ordering the outer query by a bare `rowid` fails with
  // "no such column: rowid".
  //
  // rowid, not id, is the tie-break. `id` defaults to crypto.randomUUID(), so
  // two rows written in the same millisecond ordered RANDOMLY -- retention
  // could evict the newer scan and the trend window could shuffle between
  // reads. sqlite's rowid is monotonic per insert, so ties resolve to true
  // insertion order.
  //
  // Newest `limit` rows, then flipped to oldest-first. A bare ORDER BY ASC
  // with a LIMIT would return the OLDEST n instead, i.e. a chart that stops
  // updating once an owner passes the limit.
  const selectTrend = db.prepare(`
    SELECT * FROM (
      SELECT id, created_at, verdict, findings_fresh, findings_baselined,
             rowid AS insertion_seq
        FROM scan_records
       WHERE owner_id = @owner_id
         AND schema_version = @schema_version
         AND (@repo_ref IS NULL OR repo_ref = @repo_ref)
       ORDER BY created_at DESC, insertion_seq DESC
       LIMIT @limit
    )
    ORDER BY created_at ASC, insertion_seq ASC
  `);

  const writeWithRetention = db.transaction(
    (params: ScanRecordInsertParams): string[] => {
      insert.run(params);
      const evictable = selectEvictable.all({
        owner_id: ownerId,
        keep: MAX_SCAN_RECORDS_PER_OWNER,
      }) as Array<{ id: string; artifact_path: string | null }>;
      const paths: string[] = [];
      for (const row of evictable) {
        deleteById.run(ownerId, row.id);
        if (row.artifact_path !== null) paths.push(row.artifact_path);
      }
      return paths;
    },
  );

  function clampSample(
    sample: readonly ScanFindingEntry[] | undefined,
  ): ScanFindingEntry[] {
    if (!Array.isArray(sample)) return [];
    // The declared type is a promise, not a guarantee: this input crosses a
    // route boundary, so each entry is re-checked rather than trusted.
    const entries = sample as readonly Partial<ScanFindingEntry>[];
    return entries.slice(0, MAX_INLINE_FINDING_ENTRIES).map((entry) => ({
      rule: String(entry?.rule ?? "").slice(0, MAX_FINDING_FIELD_CHARS),
      file: String(entry?.file ?? "").slice(0, MAX_FINDING_FIELD_CHARS),
      specifier: String(entry?.specifier ?? "").slice(
        0,
        MAX_FINDING_FIELD_CHARS,
      ),
    }));
  }

  return {
    record(input) {
      const projectName = (input.projectName ?? "").trim();
      if (projectName.length === 0) {
        return rejected("projectName is required");
      }
      if (projectName.length > MAX_PROJECT_NAME_CHARS) {
        return rejected(
          `projectName exceeds ${MAX_PROJECT_NAME_CHARS} characters`,
        );
      }
      if (!isScanTier(input.tier)) {
        return rejected(`Unknown scan tier: ${String(input.tier)}`);
      }
      if (!isScanVerdict(input.verdict)) {
        return rejected(`Unknown scan verdict: ${String(input.verdict)}`);
      }

      const artifact = input.artifact ?? null;
      if (artifact !== null) {
        // Never store a path the volume does not own: a later cleanup pass
        // unlinks exactly what this column names.
        // Scoped to THIS owner's directory, not the shared root. Checking the
        // shared root only proves the path is ours collectively -- owner A
        // could name owner B's artifact, and since record() hands
        // evictedArtifactPaths back for the caller to unlink, retention would
        // then delete another tenant's file. Cross-tenant deletion is not a
        // hypothetical consequence of a wrong path; it is the mechanism.
        const ownerDir = join(resolve(artifactsRoot), assertSafeSegmentOrNull(ownerId) ?? "\u0000");
        if (
          typeof artifact.path !== "string" ||
          !isPathInside(ownerDir, artifact.path)
        ) {
          return rejected(
            "Artifact path is outside this owner's artifacts directory",
          );
        }
        if (
          typeof artifact.bytes !== "number" ||
          !Number.isFinite(artifact.bytes) ||
          artifact.bytes < 0 ||
          artifact.bytes > MAX_ARTIFACT_BYTES
        ) {
          return rejected("Artifact size is out of range");
        }
      }

      const sample = clampSample(input.findingsSample);
      const findings: ScanFindingCounts = {
        fresh: count(input.findings?.fresh),
        baselined: count(input.findings?.baselined),
        stale: count(input.findings?.stale),
        expired: count(input.findings?.expired),
      };
      const record: ScanRecord = {
        id: input.id ?? crypto.randomUUID(),
        projectName,
        repoRef: clip(input.repoRef, MAX_REPO_REF_CHARS),
        tier: input.tier,
        verdict: input.verdict,
        exitCode: nullableInt(input.exitCode),
        filesScanned: nullableInt(input.filesScanned),
        findings,
        findingsSample: sample,
        // The sample can never claim more entries than the stated total.
        findingsTotal: Math.max(count(input.findingsTotal), sample.length),
        layoutExcerpt: clip(input.layoutExcerpt, MAX_SCAN_LAYOUT_EXCERPT_CHARS),
        reportMarkdown: clip(input.reportMarkdown, MAX_SCAN_REPORT_CHARS),
        errorMessage: clip(input.errorMessage, MAX_SCAN_ERROR_CHARS),
        artifact,
        createdAt: input.now ?? Date.now(),
      };

      try {
        const evictedArtifactPaths = writeWithRetention({
          id: record.id,
          owner_id: ownerId,
          schema_version: SCAN_RECORD_SCHEMA_VERSION,
          project_name: record.projectName,
          repo_ref: record.repoRef,
          tier: record.tier,
          verdict: record.verdict,
          exit_code: record.exitCode,
          files_scanned: record.filesScanned,
          findings_fresh: findings.fresh,
          findings_baselined: findings.baselined,
          findings_stale: findings.stale,
          findings_expired: findings.expired,
          layout_excerpt: record.layoutExcerpt,
          report_markdown: record.reportMarkdown,
          error_message: record.errorMessage,
          findings_sample: JSON.stringify({
            entries: sample,
            total: record.findingsTotal,
          }),
          artifact_path: artifact?.path ?? null,
          artifact_bytes: artifact?.bytes ?? null,
          created_at: record.createdAt,
        });
        return { success: true, value: { record, evictedArtifactPaths } };
      } catch (cause) {
        const duplicate =
          cause instanceof Error &&
          /UNIQUE constraint|PRIMARY KEY/i.test(cause.message);
        if (duplicate) {
          return {
            success: false,
            error: persistError(
              "Conflict",
              `A scan record with id ${record.id} already exists`,
            ),
          };
        }
        return {
          success: false,
          error: persistError(
            "SerializationFailed",
            "Failed to persist scan record",
            cause,
          ),
        };
      }
    },

    list(options = {}) {
      try {
        const rows = selectMany.all({
          owner_id: ownerId,
          schema_version: SCAN_RECORD_SCHEMA_VERSION,
          repo_ref: options.repoRef ?? null,
          limit: clampLimit(options.limit, 50),
        }) as ScanRecordRow[];
        const records: ScanRecord[] = [];
        for (const row of rows) {
          const record = rowToRecord(row);
          // Drop, do not fail the listing. Unlike saved_projects -- where one
          // bad payload failing the whole load is correct, because that data is
          // user-authored and irreplaceable -- a scan record is derived, so
          // hiding one unreadable row beats hiding an entire scan history.
          if (record !== null) records.push(record);
        }
        return { success: true, value: records };
      } catch (cause) {
        return {
          success: false,
          error: persistError(
            "DeserializationFailed",
            "Failed to list scan records",
            cause,
          ),
        };
      }
    },

    get(id) {
      try {
        const row = selectOne.get({
          owner_id: ownerId,
          id,
          schema_version: SCAN_RECORD_SCHEMA_VERSION,
        }) as ScanRecordRow | undefined;
        if (!row) {
          return {
            success: false,
            error: persistError("NotFound", `No scan record with id ${id}`),
          };
        }
        const record = rowToRecord(row);
        if (record === null) {
          // The caller named THIS record, so silence would be a lie.
          return {
            success: false,
            error: persistError(
              "DeserializationFailed",
              `Scan record ${id} is stored in an unreadable shape`,
            ),
          };
        }
        return { success: true, value: record };
      } catch (cause) {
        return {
          success: false,
          error: persistError(
            "DeserializationFailed",
            `Failed to read scan record ${id}`,
            cause,
          ),
        };
      }
    },

    trend(options = {}) {
      try {
        const rows = selectTrend.all({
          owner_id: ownerId,
          schema_version: SCAN_RECORD_SCHEMA_VERSION,
          repo_ref: options.repoRef ?? null,
          limit: clampLimit(options.limit, 50),
        }) as ScanTrendRow[];
        const points: ScanTrendPoint[] = [];
        for (const row of rows) {
          // The trend never touches findings_sample, so a corrupt blob cannot
          // blank out the chart -- only an unreadable verdict drops a point.
          if (!isScanVerdict(row.verdict)) continue;
          points.push({
            id: row.id,
            createdAt: row.created_at,
            verdict: row.verdict,
            fresh: row.findings_fresh,
            baselined: row.findings_baselined,
          });
        }
        return { success: true, value: points };
      } catch (cause) {
        return {
          success: false,
          error: persistError(
            "DeserializationFailed",
            "Failed to read scan trend",
            cause,
          ),
        };
      }
    },
  };
}
