import { useState, useEffect, useRef, useCallback } from "react";
import type { WizardData } from "@hexagen/shared";

export function useProjectGeneration(wizardData: WizardData) {
  const [files, setFiles] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState<boolean>(false);

  const lastGeneratedRef = useRef<string | null>(null);

  const generate = useCallback(
    async (force = false) => {
      const currentDataStr = JSON.stringify(wizardData);

      if (!force && lastGeneratedRef.current === currentDataStr) {
        setIsStale(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            wizardData,
            outputFormat: "json",
          }),
        });

        if (!response.ok) {
          throw new Error(`Server error: ${response.statusText}`);
        }

        const data = await response.json();
        if (data.error) throw new Error(data.error);

        const fileMap = new Map<string, string>(
          Object.entries(data.files || {}),
        );

        setFiles(fileMap);
        lastGeneratedRef.current = currentDataStr;
        setIsStale(false);
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : "An unexpected error occurred during generation.";
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [wizardData],
  );

  // Check for staleness without triggering generation
  useEffect(() => {
    if (
      lastGeneratedRef.current &&
      lastGeneratedRef.current !== JSON.stringify(wizardData)
    ) {
      setIsStale(true);
    } else {
      setIsStale(false);
    }
  }, [wizardData]);

  // Auto-generate on mount if we have no files
  useEffect(() => {
    if (files.size === 0 && !loading) {
      generate();
    }
  }, [files.size, loading, generate]);

  return {
    files,
    loading,
    error,
    isStale,
    refresh: () => generate(true),
  };
}
