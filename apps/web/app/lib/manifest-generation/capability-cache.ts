import type { CapabilitiesResponse } from "../../../features/manifest-generation/types/capabilities";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  data: CapabilitiesResponse;
  timestamp: number;
}

let cache: CacheEntry | null = null;

/**
 * Custom event dispatched when BYOK keys are added/updated.
 * Listeners should invalidate the capability cache.
 */
export const BYOK_KEY_UPDATED_EVENT = "byok-key-updated";

/**
 * Dispatch event to invalidate capability cache across tabs/windows.
 * Used when user adds/updates/revokes BYOK keys.
 */
export function invalidateCapabilityCache(): void {
  cache = null;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(BYOK_KEY_UPDATED_EVENT));
  }
}

/**
 * Fetch capabilities from server, with 5-min TTL client-side cache.
 */
export async function getCapabilities(): Promise<CapabilitiesResponse> {
  const now = Date.now();

  if (cache && now - cache.timestamp < CACHE_TTL_MS) {
    return cache.data;
  }

  try {
    const response = await fetch("/api/manifest/capabilities", {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch capabilities: ${response.status}`);
    }

    const data: CapabilitiesResponse = await response.json();
    cache = { data, timestamp: now };
    return data;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown error fetching capabilities";
    // Preserve the original failure (stack, errno, nested fetch cause) via the
    // ES2022 Error.cause option instead of stringifying and discarding it.
    throw new Error(`Capability probe failed: ${message}`, { cause: error });
  }
}

/**
 * Listen for cache invalidation events across browser tabs.
 */
export function onCapabilityCacheInvalidated(callback: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handler = () => {
    cache = null;
    callback();
  };

  window.addEventListener(BYOK_KEY_UPDATED_EVENT, handler);

  return () => {
    window.removeEventListener(BYOK_KEY_UPDATED_EVENT, handler);
  };
}
