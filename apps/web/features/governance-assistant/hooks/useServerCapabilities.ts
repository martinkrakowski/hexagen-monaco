"use client";

import { useEffect, useState } from "react";
import { getCapabilities } from "@/lib/manifest-generation";
import type { ServerCapabilityNames } from "../GovernanceAssistantPanel/types";

export type { ServerCapabilityNames };

/**
 * The governance panel's single capability probe (REA-006).
 *
 * Two components used to run this effect independently — the panel (for the
 * footer label) and the local-mode settings card (for the settings rows) — with
 * different fallbacks, so the two surfaces could name different models, and a
 * cold open of the settings card issued a second request while the first was
 * still in flight. Only the boundary calls this now; the names travel down as
 * props.
 *
 * `getCapabilities` keeps its own 5-minute TTL cache. That cache is a
 * nice-to-have here, not the mechanism: the reason there is one request is that
 * there is one call site.
 */
export function useServerCapabilities(): ServerCapabilityNames {
  const [names, setNames] = useState<ServerCapabilityNames>({});

  useEffect(() => {
    let cancelled = false;

    getCapabilities()
      .then((capabilities) => {
        if (cancelled) return;
        setNames({
          chatModelName: capabilities.activeModelName || undefined,
          generationModelName: capabilities.generationModelName || undefined,
        });
      })
      .catch((error: unknown) => {
        if (process.env.NODE_ENV !== "production") {
          console.error("Governance panel capability probe failed:", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return names;
}
