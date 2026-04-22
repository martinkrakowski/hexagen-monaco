/**
 * CacheEntry - Value object representing an entry in the semantic cache.
 * The cache key explicitly excludes non-semantic/spatial data to prevent leakage.
 */

export interface CacheEntry {
  readonly key: string; // hash(normalized DomainAST + RRP version)
  readonly value: unknown;
  readonly timestamp: number;
  readonly ttl: number; // time to live in milliseconds
}

/**
 * Creates a CacheEntry.
 *
 * @param key - The cache key (should be hash of normalized DomainAST + RRP version)
 * @param value - The cached value
 * @param ttl - Time to live in milliseconds (default: 5 minutes)
 */
export const createCacheEntry = (
  key: string,
  value: unknown,
  ttl: number = 5 * 60 * 1000, // 5 minutes default
): CacheEntry => {
  return {
    key,
    value,
    timestamp: Date.now(),
    ttl,
  };
};

/**
 * Returns true if the cache entry has expired.
 */
export const isExpired = (entry: CacheEntry): boolean => {
  return Date.now() - entry.timestamp > entry.ttl;
};

/**
 * Returns the time until expiration in milliseconds.
 */
export const timeToLive = (entry: CacheEntry): number => {
  const elapsed = Date.now() - entry.timestamp;
  return Math.max(0, entry.ttl - elapsed);
};

/**
 * Normalizes a DomainAST by removing non-semantic data.
 * This is used to create cache keys that don't leak spatial/transient data.
 *
 * Note: This is a simplified version. In practice, this would remove things like:
 * - node positions
 * - edge routing points
 * - viewport state
 * - selection state
 * - transient UI flags
 */
export const normalizeDomainASTForCache = (ast: unknown): unknown => {
  // In a real implementation, this would strip out non-semantic fields
  // For now, we return the ast as-is but note that consumers should
  // ensure they pass only semantic data for hashing
  return ast;
};
