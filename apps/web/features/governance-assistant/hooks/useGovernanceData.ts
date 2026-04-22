"use client";

import { useState, useCallback, useEffect } from "react";

interface Violation {
  id: string;
  type: "error" | "warning" | "info";
  message: string;
  context?: string;
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

interface UseGovernanceDataReturn {
  data: GovernanceData;
  isLoading: boolean;
  error: string | null;
  /** Manual refresh — re-fetches from the legacy GET endpoints (disk-based). */
  refresh: () => void;
  /** Refresh with dynamic data — posts manifestYaml + openFileContent to /api/governance/refresh. */
  refreshWithData: (
    manifestYaml: string,
    openFileContent?: string,
  ) => Promise<void>;
}

const emptyData: GovernanceData = {
  violations: [],
  suggestions: [],
  portAdapterStatus: [],
};

export function useGovernanceData(): UseGovernanceDataReturn {
  const [data, setData] = useState<GovernanceData>(emptyData);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Legacy refresh — GET from separate endpoints (reads from disk)
  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [violationsRes, suggestionsRes, statusRes] = await Promise.all([
        fetch("/api/governance/violations"),
        fetch("/api/governance/suggestions"),
        fetch("/api/governance/status"),
      ]);

      const [violationsData, suggestionsData, statusData] = await Promise.all([
        violationsRes.json(),
        suggestionsRes.json(),
        statusRes.json(),
      ]);

      setData({
        violations: violationsData.violations || [],
        suggestions: suggestionsData.suggestions || [],
        portAdapterStatus: statusData.status || [],
      });

      if (violationsData.error || suggestionsData.error || statusData.error) {
        setError(
          violationsData.error ||
            suggestionsData.error ||
            statusData.error ||
            "Failed to fetch governance data",
        );
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch governance data",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Auto-fetch governance data on mount — CR1 fix
  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Dynamic refresh — POST manifest + open file content to combined endpoint
  const refreshWithData = useCallback(
    async (manifestYaml: string, openFileContent?: string) => {
      setIsLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/governance/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ manifestYaml, openFileContent }),
        });

        const result = await res.json();

        if (!res.ok) {
          setError(result.error || "Governance refresh failed");
          return;
        }

        setData({
          violations: result.violations || [],
          suggestions: result.suggestions || [],
          portAdapterStatus: result.portAdapterStatus || [],
        });
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to refresh governance data",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  return {
    data,
    isLoading,
    error,
    refresh: fetchAll,
    refreshWithData,
  };
}
