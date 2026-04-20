import type { DomainAST } from "@hexagen/core-domain";

/**
 * SemanticCachePort — outbound port for caching intent compilation results.
 */
export interface SemanticCachePort {
  /** Get a cached result for the given key */
  get(key: string): DomainAST | null;

  /** Store a result in the cache with optional TTL */
  set(key: string, value: DomainAST, ttlMs?: number): void;

  /** Check if a key exists in the cache */
  has(key: string): boolean;

  /** Remove a key from the cache */
  delete(key: string): boolean;

  /** Clear the entire cache */
  clear(): void;

  /** Get cache statistics */
  stats(): { hits: number; misses: number; size: number };
}
