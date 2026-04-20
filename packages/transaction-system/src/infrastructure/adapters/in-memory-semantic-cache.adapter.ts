import type { DomainAST } from "@hexagen/core-domain";
import type { SemanticCachePort } from "../../application/ports/out/semantic-cache.port.js";

interface CacheEntry {
  value: DomainAST;
  expiresAt: number | null;
}

/**
 * In-memory Semantic Cache — LRU-style cache with optional TTL for
 * intent compilation results.
 */
export class InMemorySemanticCache implements SemanticCachePort {
  private cache: Map<string, CacheEntry> = new Map();
  private hits = 0;
  private misses = 0;

  get(key: string): DomainAST | null {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    // Check TTL expiration
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    return entry.value;
  }

  set(key: string, value: DomainAST, ttlMs?: number): void {
    const expiresAt = ttlMs ? Date.now() + ttlMs : null;
    this.cache.set(key, { value, expiresAt });
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
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
