/**
 * TransactionId - Value object representing a stable hash-based identifier for transactions.
 */

export interface TransactionId {
  readonly brand: unique symbol;
}

/**
 * Creates a TransactionId from a string.
 * In a real implementation, this would be a stable hash (e.g., of intent + REM + lineage).
 * For now, we use a simple string wrapper with branding.
 */
export const createTransactionId = (id: string): TransactionId => {
  return id as unknown as TransactionId;
};

/**
 * Returns the string value of a TransactionId.
 */
export const transactionIdValue = (id: TransactionId): string => {
  return id as unknown as string;
};
