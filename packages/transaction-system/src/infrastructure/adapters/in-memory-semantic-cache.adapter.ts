import type { SemanticCachePort } from "../../application/ports/out/semantic-cache.port.js";
import type { CacheEntry } from "../../domain/value-objects/cache-entry.js";
import {
  createCacheEntry,
  isExpired,
} from "../../domain/value-objects/cache-entry.js";

/**
 * In-memory Semantic Cache — stores intent compilation results keyed by
 * the hash of normalized DomainAST + RRP version.
 *
 * Note: The cache key must be computed as hash(normalized DomainAST + RRP version)
 * by the caller to ensure semantic equivalence and avoid leaking non-semantic data.
 */
export class InMemorySemanticCache implements SemanticCachePort {
  private cache: Map<string, CacheEntry> = new Map();
  private hits = 0;
  private misses = 0;

  get(key: string): CacheEntry | null {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    if (isExpired(entry)) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    return entry;
  }

  set(key: string, value: unknown, ttlMs: number = 5 * 60 * 1000): void {
    const entry = createCacheEntry(key, value, ttlMs);
    this.cache.set(key, entry);
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (isExpired(entry)) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  stats(): { hits: number; misses: number; size: number } {
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
    };
  }
}
