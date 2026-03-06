/**
 * Result shape returned by each individual generator function.
 */
export interface GeneratorResult {
  created: string[];
  skipped: string[];
  updated: string[];
  dryRunOperations: number;
  summary?: string;
  error?: Error;
}

/**
 * Aggregate result for the whole sync run.
 */
export interface SyncSummary {
  totalCreated: number;
  totalSkipped: number;
  totalUpdated: number;
  totalDryRunOps: number;
  byGenerator: Record<string, GeneratorResult>;
  processedModules: string[];
  durationMs: number;
  wasDryRun: boolean;
  fatalErrors: string[];
}

/** Helper */
export function createEmptyResult(): GeneratorResult {
  return {
    created: [],
    skipped: [],
    updated: [],
    dryRunOperations: 0,
  };
}
