// packages/sync/src/results.ts

/**
 * Result shape returned by each individual generator function.
 * All generators should return this instead of void to enable
 * structured reporting, dry-run summaries, and future telemetry.
 */
export interface GeneratorResult {
  /** Absolute paths of files/directories actually created or modified */
  created: string[];

  /** Absolute paths of files/directories that already existed and were skipped */
  skipped: string[];

  /** Absolute paths of files/directories that were updated (overwritten with force) */
  updated: string[];

  /** Number of filesystem operations that would have been performed in dry-run mode */
  dryRunOperations: number;

  /** Optional short description of what this generator did (shown in summary) */
  summary?: string;

  /** If any error occurred during generation (still returns partial results) */
  error?: Error;
}

/**
 * Aggregate result collected from all generators during one sync run.
 * Used by SyncEngine to produce the final console report.
 */
export interface SyncSummary {
  /** Total across all generators */
  totalCreated: number;
  totalSkipped: number;
  totalUpdated: number;
  totalDryRunOps: number;

  /** Breakdown per generator name */
  byGenerator: Record<string, GeneratorResult>;

  /** Modules that were processed */
  processedModules: string[];

  /** Time taken (ms) */
  durationMs: number;

  /** Whether dry-run mode was active */
  wasDryRun: boolean;

  /** Top-level errors that prevented full sync (rare) */
  fatalErrors: string[];
}

/**
 * Helper to create an empty initial result for a generator
 */
export function createEmptyResult(): GeneratorResult {
  return {
    created: [],
    skipped: [],
    updated: [],
    dryRunOperations: 0,
  };
}

/**
 * Helper to merge multiple generator results into one aggregate
 */
export function mergeResults(results: GeneratorResult[]): GeneratorResult {
  const merged: GeneratorResult = createEmptyResult();

  for (const r of results) {
    merged.created.push(...r.created);
    merged.skipped.push(...r.skipped);
    merged.updated.push(...r.updated);
    merged.dryRunOperations += r.dryRunOperations;

    if (r.error) {
      merged.error = r.error; // last error wins for simplicity
    }
  }

  return merged;
}
