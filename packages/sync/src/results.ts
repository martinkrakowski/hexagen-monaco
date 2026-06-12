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
   * previously miscounted into `created`. Count surfacing in the engine
   * summary is PR-B2's (truthful counts).
   */
  deleted: string[];
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
    totalOps: 0,
  };
}
