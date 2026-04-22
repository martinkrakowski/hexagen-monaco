import type { CacheEntry } from "../../../domain/value-objects/cache-entry.js";

/**
 * SemanticCachePort — outbound port for caching intent compilation results.
 */
export interface SemanticCachePort {
  /** Get a cached entry for the given key, including metadata */
  get(key: string): CacheEntry | null;

  /** Store a result in the cache with optional TTL */
  set(key: string, value: unknown, ttlMs?: number): void;

  /** Check if a key exists in the cache */
  has(key: string): boolean;

  /** Remove a key from the cache */
  delete(key: string): boolean;

  /** Clear the entire cache */
  clear(): void;

  /** Get cache statistics */
  stats(): { hits: number; misses: number; size: number };
}
