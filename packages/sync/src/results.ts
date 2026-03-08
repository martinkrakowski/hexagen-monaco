/**
 * Result shape returned by each individual generator function.
 */
export interface GeneratorResult {
  created: string[];
  skipped: string[];
  updated: string[];
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
    totalOps: 0,
  };
}
