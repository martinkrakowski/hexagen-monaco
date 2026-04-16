import { useState, useEffect, useRef, useCallback } from "react";
import type { WizardData } from "@hexagen/shared";

const MAX_RETRIES = 3;

export function useProjectGeneration(wizardData: WizardData) {
  const [files, setFiles] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState<boolean>(false);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState<boolean>(false);

  const lastGeneratedRef = useRef<string | null>(null);
  const hasAttemptedRef = useRef(false);
  const retryCountRef = useRef(0);

  const generate = useCallback(
    async (force = false) => {
      const currentDataStr = JSON.stringify(wizardData);

      if (!force && lastGeneratedRef.current === currentDataStr) {
        setIsStale(false);
        return;
      }

      if (loading) return;

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
        retryCountRef.current = 0;
      } catch (err: unknown) {
        retryCountRef.current += 1;
        const message =
          err instanceof Error
            ? err.message
            : "An unexpected error occurred during generation.";
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [wizardData, loading],
  );

  const downloadZip = useCallback(async () => {
    if (isDownloading) return;

    setIsDownloading(true);
    setError(null);

    try {
      if (isStale) {
        await generate(true);
      }

      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wizardData,
          outputFormat: "zip",
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(
          errorData?.error || `Download failed: ${response.statusText}`,
        );
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${wizardData.governance?.workspaceName || "project"}.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to download zip.";
      setError(message);
    } finally {
      setIsDownloading(false);
    }
  }, [wizardData, isStale, isDownloading, generate]);

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

  useEffect(() => {
    if (!hasAttemptedRef.current && files.size === 0 && !loading) {
      hasAttemptedRef.current = true;
      generate();
    }
  }, [files.size, loading, generate]);

  return {
    files,
    loading,
    isDownloading,
    error,
    isStale,
    canRetry: retryCountRef.current < MAX_RETRIES,
    refresh: () => {
      if (retryCountRef.current < MAX_RETRIES) {
        generate(true);
      }
    },
    downloadZip,
  };
}
