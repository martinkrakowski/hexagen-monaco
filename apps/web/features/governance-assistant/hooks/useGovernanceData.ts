"use client";

import { useState, useCallback, useEffect } from "react";

import { fetchWithCsrf } from "@/lib/csrf-fetch";
interface Violation {
  id: string;
  type: "error" | "warning" | "info";
  message: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
}

interface AISuggestion {
  id: string;
  message: string;
  confidence: number;
  category:
    | "context-split"
    | "port-definition"
    | "dependency-cleanup"
    | "general";
}

interface PortAdapterStatus {
  context: string;
  ports: number;
  adapters: number;
  complete: boolean;
}

interface GovernanceData {
  violations: Violation[];
  suggestions: AISuggestion[];
  portAdapterStatus: PortAdapterStatus[];
}

interface UseGovernanceDataOptions {
  /** If false, skip auto-fetch on mount (for new projects without manifest) */
  enabled?: boolean;
}

interface UseGovernanceDataReturn {
  data: GovernanceData;
  isLoading: boolean;
  error: string | null;
  /** Refresh with manifest data — posts to governance endpoints */
  refresh: (manifestYaml: string, openFileContent?: string) => Promise<void>;
}

const emptyData: GovernanceData = {
  violations: [],
  suggestions: [],
  portAdapterStatus: [],
};

export function useGovernanceData(
  options: UseGovernanceDataOptions = {},
): UseGovernanceDataReturn {
  const { enabled = true } = options;
  const [data, setData] = useState<GovernanceData>(emptyData);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refresh — POST manifest to governance endpoints (no filesystem dependencies)
  const refresh = useCallback(
    async (manifestYaml: string, openFileContent?: string) => {
      if (!enabled || !manifestYaml) {
        setData(emptyData);
        setError(null);
        return;
      }
      setIsLoading(true);
      setError(null);

      try {
        const [violationsRes, suggestionsRes, statusRes] = await Promise.all([
          fetchWithCsrf("/api/governance/violations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ manifestYaml }),
          }),
          fetchWithCsrf("/api/governance/suggestions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ manifestYaml, openFileContent }),
          }),
          fetchWithCsrf("/api/governance/status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ manifestYaml }),
          }),
        ]);

        // Check for non-OK responses
        const responses = [
          { res: violationsRes, name: "violations" },
          { res: suggestionsRes, name: "suggestions" },
          { res: statusRes, name: "status" },
        ];

        for (const { res, name } of responses) {
          if (!res.ok) {
            const errorMsg = `Failed to fetch ${name}: ${res.status}`;
            setError(errorMsg);
            setIsLoading(false);
            return;
          }
        }

        const [violationsData, suggestionsData, statusData] = await Promise.all(
          [violationsRes.json(), suggestionsRes.json(), statusRes.json()],
        );

        if (violationsData.error || suggestionsData.error || statusData.error) {
          setError(
            violationsData.error ||
              suggestionsData.error ||
              statusData.error ||
              "Failed to fetch governance data",
          );
        }

        setData({
          violations: violationsData.violations || [],
          suggestions: suggestionsData.suggestions || [],
          portAdapterStatus: statusData.status || [],
        });
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to fetch governance data",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [enabled],
  );

  // Initial state when disabled or no manifest
  useEffect(() => {
    if (!enabled) {
      setData(emptyData);
      setError(null);
    }
  }, [enabled]);

  return {
    data,
    isLoading,
    error,
    refresh,
  };
}
