/**
 * Transaction - Domain entity representing a unit of work
 * in the intent processing pipeline.
 */

import type { ConflictSet, Conflict } from "./model/conflict-set.js";
import { createConflictSet } from "./model/conflict-set.js";

export type TransactionStatus =
  | "pending"
  | "speculative"
  | "committed"
  | "rolled_back"
  | "failed";

export interface RuleExecutionManifest {
  rules: Record<string, unknown>;
  constraints: Record<string, unknown>;
  appliedAt: string;
}

export interface Transaction {
  id: string;
  intentId: string;
  status: TransactionStatus;
  createdAt: number;
  updatedAt: number;
  metadata: Record<string, unknown>;
}

export function createTransaction(
  intentId: string,
  metadata: Record<string, unknown> = {},
): Transaction {
  const now = Date.now();
  return {
    id: `txn-${now}-${Math.random().toString(36).substring(2, 9)}`,
    intentId,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    metadata,
  };
}

export function transitionTransaction(
  tx: Transaction,
  status: TransactionStatus,
): Transaction {
  return {
    ...tx,
    status,
    updatedAt: Date.now(),
  };
}

export function detectConflicts(
  tx: Transaction,
  rem: RuleExecutionManifest,
): ConflictSet {
  const conflicts: Conflict[] = [];

  // Basic conflict: if REM specifies required rules and transaction doesn't meet them
  if (rem.rules && Object.keys(rem.rules).length > 0) {
    const ruleCounts = Object.keys(rem.rules).length;
    const rulesApplied = (tx.metadata.rulesApplied as number) || 0;

    if (rulesApplied < ruleCounts) {
      conflicts.push({
        type: "state-mismatch",
        severity: "warning",
        message: `REM specifies ${ruleCounts} rules but transaction has applied ${rulesApplied}`,
        remExpected: ruleCounts,
        actualState: rulesApplied,
      });
    }
  }

  // Check for lineage integrity if present
  if (tx.metadata.lineage) {
    const lineage = tx.metadata.lineage as string[];
    if (!Array.isArray(lineage) || lineage.length === 0) {
      conflicts.push({
        type: "lineage-broken",
        severity: "warning",
        message: "Lineage array is empty or malformed",
        actualState: lineage,
      });
    }
  }

  return createConflictSet(tx.id, conflicts);
}
