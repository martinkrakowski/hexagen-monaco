import type { CacheEntry } from "../../domain/value-objects/cache-entry.js";
import { isExpired } from "../../domain/value-objects/cache-entry.js";
import type { SemanticCachePort } from "../ports/out/semantic-cache.port.js";
import type { Result } from "../result.js";

/**
 * QueryCacheUseCase — retrieves an entry from the semantic cache if it exists and is not expired.
 */
export class QueryCacheUseCase {
  constructor(private readonly semanticCache: SemanticCachePort) {}

  async execute(key: string): Promise<Result<CacheEntry | null, Error>> {
    try {
      const entry = this.semanticCache.get(key);
      if (!entry) {
        return { success: true, value: null };
      }

      if (isExpired(entry)) {
        this.semanticCache.delete(key);
        return { success: true, value: null };
      }

      return { success: true, value: entry };
    } catch (err) {
      return { success: false, error: err as Error };
    }
  }
}
