/**
 * TransactionId - Value object representing a stable hash-based identifier for transactions.
 */

export interface TransactionId {
  readonly brand: unique symbol;
}

/**
 * Port interface for cryptographic hashing operations.
 * Abstracts hash computation from specific runtime implementations.
 */
export interface HashingPort {
  /**
   * Compute SHA-256 hash of input string.
   * @param input String to hash
   * @returns Hex-encoded hash
   */
  sha256(input: string): string;
}

/**
 * Creates a TransactionId from intent, REM (manifest), and lineage.
 * Computes a stable SHA-256 hash of the combined inputs.
 */
export const createTransactionId = (
  hashing: HashingPort,
  intentId: string,
  rem: string, // JSON stringified manifest
  lineage: string[], // Array of previous intent IDs
): TransactionId => {
  const combined = `${intentId}|${rem}|${lineage.join(",")}`;
  const hash = hashing.sha256(combined);
  return hash as unknown as TransactionId;
};

/**
 * Returns the string value of a TransactionId.
 */
export const transactionIdValue = (id: TransactionId): string => {
  return id as unknown as string;
};
