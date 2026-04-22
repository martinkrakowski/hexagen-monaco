/**
 * Transaction - Domain entity representing a unit of work
 * in the intent processing pipeline.
 */

export type TransactionStatus =
  | "pending"
  | "speculative"
  | "committed"
  | "rolled_back"
  | "failed";

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
