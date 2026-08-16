"use client";

import { useCallback } from "react";
import type {
  DomainModelId,
  ModelLifecyclePort,
  SendStructuredRequestPort,
} from "@hexagen/local-llm";

import { LOCAL_MODELS } from "@hexagen/local-llm";

export interface UseModelCacheReturn {
  /** True if a specific model's weights are present in IndexedDB. */
  hasModelInCache: (modelId: DomainModelId) => Promise<boolean>;
  /** True if any model in LOCAL_MODELS has cached weights. */
  hasAnyCachedModel: () => Promise<boolean>;
}

/**
 * Stateless adapter wrapper for IndexedDB cache queries. Reads the
 * same adapter singleton as useEngineLifecycle via the ref passed
 * from the parent.
 *
 * `deleteCachedModel` is NOT here because deletion can cascade into
 * engine-state transitions (when deleting the currently-loaded
 * model) — it lives in useEngineLifecycle where it can mutate state.
 */
export function useModelCache(
  adapterRef: React.MutableRefObject<
    (ModelLifecyclePort & SendStructuredRequestPort) | null
  >,
): UseModelCacheReturn {
  const hasModelInCache = useCallback(
    async (modelId: DomainModelId): Promise<boolean> => {
      const adapter = adapterRef.current;
      if (!adapter) return false;
      try {
        return await adapter.hasModelInCache(modelId);
      } catch {
        // Non-fatal — assume not cached if query fails.
        return false;
      }
    },
    [adapterRef],
  );

  const hasAnyCachedModel = useCallback(async (): Promise<boolean> => {
    const adapter = adapterRef.current;
    if (!adapter) return false;
    try {
      const results = await Promise.all(
        LOCAL_MODELS.map(async (model) => {
          try {
            return await adapter.hasModelInCache(model.modelId);
          } catch {
            return false;
          }
        }),
      );
      return results.some((isCached) => isCached);
    } catch {
      return false;
    }
  }, [adapterRef]);

  return { hasModelInCache, hasAnyCachedModel };
}
