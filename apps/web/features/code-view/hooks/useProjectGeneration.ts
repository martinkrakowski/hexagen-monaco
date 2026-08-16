import { useState, useEffect, useRef, useCallback } from "react";
import type { WizardData } from "@hexagen/project-configuration";
import type { GenerationResult } from "@hexagen/shared";
import { getGenerationResultPersistence } from "../../../app/lib/wire.client";
import { withFormStateDefaults } from "../../../app/lib/form-state-defaults";
import { resolveImportedManifestPayload } from "../../../app/lib/imported-manifest";
import type { GenerationNotices } from "../types";

const MAX_RETRIES = 3;

/**
 * `savedManifestYaml` is the loaded project's stored manifest. It is consulted
 * only when `wizardData.manifestSource === "imported"` (import round-trip
 * integrity, Item 1.3): the request then carries the parsed manifest so the
 * route's `manifest ?? wizardToManifest(wizardData)` fallback never degrades
 * the architecture — and a corrupt manifest FAILS CLOSED as a blocking error.
 * Wizard-authored projects ignore it (live-first wizardData path unchanged).
 */
export function useProjectGeneration(
  wizardData: WizardData,
  savedManifestYaml?: string | null,
) {
  const [files, setFiles] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState<boolean>(false);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState<boolean>(false);
  const [notices, setNotices] = useState<GenerationNotices>({
    warnings: [],
    errors: [],
  });

  const lastGeneratedRef = useRef<string | null>(null);
  const hasAttemptedRef = useRef(false);
  const retryCountRef = useRef(0);

  // Shared by generate() and downloadZip(): the optional `manifest` request
  // field for imported projects, or a blocking error (fail closed — never fall
  // back to the degraded wizard projection). `{}` for wizard-authored projects.
  // The decision itself is the ONE shared resolver (REA-005) — this used to be
  // a private copy that could drift from the export provider's.
  const resolveImportedManifest = useCallback(
    () => resolveImportedManifestPayload(wizardData, savedManifestYaml),
    [wizardData, savedManifestYaml],
  );

  const generate = useCallback(
    async (force = false) => {
      const currentDataStr = JSON.stringify(wizardData);

      if (!force && lastGeneratedRef.current === currentDataStr) {
        setIsStale(false);
        return;
      }

      if (loading) return;

      const resolved = resolveImportedManifest();
      if (!resolved.ok) {
        setError(resolved.message);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            // Normalize at the boundary (same helper as the export path) so a
            // legacy/partial session still carries addOnsAnswers + schema defaults.
            // For imported projects `manifest` rides along and wins server-side
            // (`manifest ?? wizardToManifest(wizardData)`); wizardData still
            // carries addOnsAnswers.
            wizardData: withFormStateDefaults(wizardData),
            outputFormat: "json",
            ...resolved.extra,
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
        // Add-on materialization notices (warnings = overrides; errors = a bad
        // selection whose add-ons were omitted — detail in HEXAGEN-ADDON-NOTICES.md).
        setNotices({
          warnings: Array.isArray(data.warnings) ? data.warnings : [],
          errors: Array.isArray(data.errors) ? data.errors : [],
        });

        try {
          const persistence = getGenerationResultPersistence();
          const result: GenerationResult = {
            projectId: wizardData.governance?.workspaceName || "default",
            timestamp: Date.now(),
            files: Object.fromEntries(fileMap),
            manifestYaml: data.manifestYaml || "",
            source: "server",
          };
          await persistence.saveResult(result);
        } catch {
          // Persistence failure is non-fatal — generation still succeeded
        }
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
    [wizardData, loading, resolveImportedManifest],
  );

  const downloadZip = useCallback(async () => {
    if (isDownloading) return;

    const resolved = resolveImportedManifest();
    if (!resolved.ok) {
      setError(resolved.message);
      return;
    }

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
          wizardData: withFormStateDefaults(wizardData),
          outputFormat: "zip",
          ...resolved.extra,
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
  }, [wizardData, isStale, isDownloading, generate, resolveImportedManifest]);

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
    notices,
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
