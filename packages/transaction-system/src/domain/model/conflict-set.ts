/**
 * ConflictSet — represents detected conflicts between a transaction's state
 * and the RuleExecutionManifest that governs it.
 */

export type ConflictType =
  | "state-mismatch"
  | "lineage-broken"
  | "authority-violation";

export type ConflictSeverity = "warning" | "error";

export interface Conflict {
  type: ConflictType;
  severity: ConflictSeverity;
  message: string;
  remExpected?: unknown;
  actualState?: unknown;
}

export interface ConflictSet {
  transactionId: string;
  hasConflicts: boolean;
  conflicts: Conflict[];
  detectedAt: Date;
}

export function createConflictSet(
  transactionId: string,
  conflicts: Conflict[] = [],
): ConflictSet {
  return {
    transactionId,
    hasConflicts: conflicts.length > 0,
    conflicts,
    detectedAt: new Date(),
  };
}
