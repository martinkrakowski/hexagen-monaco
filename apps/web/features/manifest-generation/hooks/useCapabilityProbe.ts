"use client";

import { useEffect, useState } from "react";
import {
  getCapabilities,
  onCapabilityCacheInvalidated,
} from "@/lib/manifest-generation";
import type { CapabilitiesResponse } from "../types/capabilities";

/**
 * Custom hook to probe and subscribe to LLM capabilities cache.
 * Acts as a semantic wrapper for syncing with the capability registry.
 */
export function useCapabilityProbe(
  hasServerApiKey: boolean,
): CapabilitiesResponse | null {
  const [capabilities, setCapabilities] = useState<CapabilitiesResponse | null>(
    null,
  );

  useEffect(() => {
    const probe = async () => {
      try {
        const result = await getCapabilities();
        setCapabilities(result);
      } catch {
        setCapabilities({ capabilities: [], canGenerate: hasServerApiKey });
      }
    };

    probe();

    const unsubscribe = onCapabilityCacheInvalidated(() => {
      probe();
    });

    return unsubscribe;
  }, [hasServerApiKey]);

  return capabilities;
}
