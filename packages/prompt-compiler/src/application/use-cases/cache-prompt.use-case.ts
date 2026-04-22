import type { CachePromptPort } from "../ports/in/cache-prompt.port";
import type { PromptTemplate } from "../../domain/prompt-template";
import type { PromptCacheKey } from "../../domain/prompt-cache-key";

/**
 * Use case for caching and retrieving prompt templates.
 * This use case provides functionality to store prompt templates in a cache
 * to avoid redundant computation and retrieve them when needed.
 */
export class CachePromptUseCase {
  constructor(private readonly cachePromptPort: CachePromptPort) {}

  /**
   * Cache a prompt template with its variable values
   * @param request Contains the template and variables to cache
   * @returns Promise resolving to the cache key used for storage
   */
  async cache(request: {
    template: PromptTemplate;
    variables: Record<string, string>;
  }): Promise<PromptCacheKey> {
    return this.cachePromptPort.cache(request);
  }

  /**
   * Retrieve a cached prompt template
   * @param request Contains template ID and variables to lookup
   * @returns Promise resolving to the cached template if found, null otherwise
   */
  async retrieve(request: {
    templateId: string;
    variables: Record<string, string>;
  }): Promise<PromptTemplate | null> {
    return this.cachePromptPort.retrieve(request);
  }
}
