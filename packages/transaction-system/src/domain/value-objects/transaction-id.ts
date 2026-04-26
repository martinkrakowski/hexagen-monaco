import { createHash } from "node:crypto";

/**
 * TransactionId - Value object representing a stable hash-based identifier for transactions.
 */

export interface TransactionId {
  readonly brand: unique symbol;
}

/**
 * Creates a TransactionId from intent, REM (manifest), and lineage.
 * Computes a stable SHA-256 hash of the combined inputs.
 */
export const createTransactionId = (
  intentId: string,
  rem: string, // JSON stringified manifest
  lineage: string[], // Array of previous intent IDs
): TransactionId => {
  const combined = `${intentId}|${rem}|${lineage.join(",")}`;
  const hash = createHash("sha256").update(combined).digest("hex");
  return hash as unknown as TransactionId;
};

/**
 * Returns the string value of a TransactionId.
 */
export const transactionIdValue = (id: TransactionId): string => {
  return id as unknown as string;
};
