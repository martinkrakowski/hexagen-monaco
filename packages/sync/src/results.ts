/**
 * Outcome vocabulary of `safeWriteFileAtomic` (fs-utils.ts). Declared here so
 * every generator routes the same closed set through `recordWriteStatus`
 * below instead of re-spelling the union (pre-B2, three generators carried
 * private copies and two of them miscounted — see the helper's doc).
 */
export type WriteStatus =
  | "created"
  | "updated"
  | "unchanged"
  | "skipped"
  | "protected";

/**
 * Result shape returned by each individual generator function.
 */
export interface GeneratorResult {
  created: string[];
  skipped: string[];
  updated: string[];
  /**
   * Paths removed (or, under --dry-run, that WOULD be removed) by a generator.
   * Introduced in PR-A2 for the empty-barrel unlink path — deletions were
   * previously miscounted into `created`; surfaced in the engine summary since
   * PR-B2 (truthful counts).
   */
  deleted: string[];
  /**
   * Paths whose generated content already matched on disk byte-for-byte
   * (PR-B2, RCA #5). A converged tree lands everything here — `created`/
   * `updated`/`deleted` mean an actual (or, under --dry-run, a planned)
   * mutation, which is what `sync --check` gates on.
   */
  unchanged: string[];
  totalOps: number;
  summary?: string;
  error?: Error;
}

/**
 * Factory for empty result.
 */
export function createEmptyResult(): GeneratorResult {
  return {
    created: [],
    skipped: [],
    updated: [],
    deleted: [],
    unchanged: [],
    totalOps: 0,
  };
}

/**
 * Run-level aggregate returned by `SyncEngine.run()` (PR-B2). Counts sum every
 * generator's buckets; `totalOps` is the number of actual (real run) or planned
 * (--dry-run) mutations — creates + updates + deletes. A converged tree
 * reports `totalOps: 0`, which is exactly what `sync --check` gates on (the
 * CLI exits non-zero iff `totalOps > 0`; the exit-code decision stays in
 * cli.ts per the A1 doctrine — the engine only reports).
 */
export interface SyncRunSummary {
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
  skipped: number;
  totalOps: number;
  durationMs: number;
}

/**
 * The single routing truth from a write status to the result buckets
 * (PR-B2, RCA #5). Before this helper each generator hand-rolled the same
 * if-chain, and two of them lied: shared-kernel counted updates as `created`
 * and `unchanged` as `skipped`; layer-folders counted directory mkdirs as
 * `created` on every run. Routing rules:
 *
 *   created / updated → their bucket, +1 totalOps (a real or planned change)
 *   unchanged         → `unchanged`, NOT an op (nothing was or would be written)
 *   skipped / protected → `skipped`, NOT an op (deliberately left alone)
 *
 * Deletions don't flow through here — they are not a `safeWriteFileAtomic`
 * outcome; the deleting generator pushes `result.deleted` itself (recursive.ts).
 */
export function recordWriteStatus(
  result: GeneratorResult,
  filePath: string,
  status: WriteStatus,
): void {
  if (status === "created") {
    result.created.push(filePath);
    result.totalOps += 1;
  } else if (status === "updated") {
    result.updated.push(filePath);
    result.totalOps += 1;
  } else if (status === "unchanged") {
    result.unchanged.push(filePath);
  } else {
    // "skipped" | "protected"
    result.skipped.push(filePath);
  }
}
