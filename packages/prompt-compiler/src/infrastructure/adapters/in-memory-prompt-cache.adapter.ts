import type { PromptTemplate } from "../../domain/prompt-template";
import type { PromptCachePort } from "../../application/ports/out/cache.port";

/**
 * In-memory implementation of the PromptCachePort.
 * Stores prompt templates in a simple Map with optional TTL support.
 */
export class InMemoryPromptCacheAdapter implements PromptCachePort {
  private cache = new Map<
    string,
    { template: PromptTemplate; expiresAt: number | null }
  >();
  private readonly defaultTTL = 5 * 60 * 1000; // 5 minutes default TTL

  async get(key: string): Promise<PromptTemplate | null> {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    // Check if entry has expired
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.template;
  }

  async set(
    key: string,
    template: PromptTemplate,
    ttlMs?: number,
  ): Promise<void> {
    const expiresAt =
      ttlMs !== undefined
        ? Date.now() + ttlMs
        : ttlMs === null
          ? null
          : Date.now() + this.defaultTTL;

    this.cache.set(key, { template, expiresAt });
  }

  async has(key: string): Promise<boolean> {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    // Check if entry has expired
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  async delete(key: string): Promise<boolean> {
    return this.cache.delete(key);
  }

  async clear(): Promise<void> {
    this.cache.clear();
  }
}
