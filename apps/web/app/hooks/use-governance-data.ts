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
  refresh: () => void;
}

export function useGovernanceData(): UseGovernanceDataReturn {
  const [data, setData] = useState<GovernanceData>({
    violations: [],
    suggestions: [],
    portAdapterStatus: [],
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return {
    data,
    isLoading,
    error,
    refresh: fetchAll,
  };
}
