import type { Identifier } from "@hexagen/shared";
import type { PromptTemplate, PromptCacheKey } from "../../../domain/index.js";

/**
 * Request to cache a prompt template
 */
export interface CachePromptRequest {
  /** The prompt template to cache */
  template: PromptTemplate;
  /** Variable values used to generate this specific prompt */
  variables: Record<string, string>;
}

/**
 * Request to retrieve a cached prompt template
 */
export interface RetrieveCachedPromptRequest {
  /** The prompt template ID */
  templateId: Identifier;
  /** Variable values used when the prompt was cached */
  variables: Record<string, string>;
}

/**
 * Port for caching and retrieving prompt templates to avoid redundant computation
 */
export interface CachePromptPort {
  /**
   * Cache a prompt template with its variable values
   * @param request Contains the template and variables to cache
   * @returns Promise resolving to the cache key used for storage
   */
  cache(request: CachePromptRequest): Promise<PromptCacheKey>;

  /**
   * Retrieve a cached prompt template
   * @param request Contains template ID and variables to lookup
   * @returns Promise resolving to the cached template if found, null otherwise
   */
  retrieve(
    request: RetrieveCachedPromptRequest,
  ): Promise<PromptTemplate | null>;
}

/**
 * Type guard for CachePromptPort
 */
export function isCachePromptPort(port: unknown): port is CachePromptPort {
  if (port === null || typeof port !== "object") return false;
  const p = port as Record<string, unknown>;
  return typeof p.cache === "function" && typeof p.retrieve === "function";
}
