import { useCallback, useState } from "react";
import type { ProjectConfig } from "@hexagen/project-configuration";
import { wizardToManifest } from "@hexagen/wizard-orchestration";
import {
  isImportedFormState,
  parseImportedManifest,
} from "@/lib/imported-manifest";

import { fetchWithCsrf } from "@/lib/csrf-fetch";
export type GenerationOutcome =
  | { kind: "success"; projectId: string; manifestYaml: string }
  | { kind: "validation-error"; errors: string[] }
  | { kind: "network-error"; message: string }
  | { kind: "server-error"; status: number; message: string };

export interface UseProjectGenerationFlowReturn {
  isLoading: boolean;
  /**
   * `savedManifestYaml` is the loaded project's stored manifest, consulted ONLY
   * when `config.manifestSource === "imported"` (import round-trip integrity,
   * Item 1.5): generation then runs off the rich manifest instead of the lossy
   * `wizardToManifest(config)` projection, and FAILS CLOSED if that manifest no
   * longer parses. Omit/null for wizard-authored and genesis flows.
   */
  execute: (
    config: ProjectConfig,
    savedManifestYaml?: string | null,
  ) => Promise<GenerationOutcome>;
}

interface UseProjectGenerationFlowOptions {
  saveProject: (
    name: string,
    formState: ProjectConfig,
    manifestYaml: string,
  ) => Promise<string | null>;
  setActiveWorkspace: (workspace: {
    projectId: string;
    name: string;
    isDirty: boolean;
    lastModifiedAt: number;
    wizardData: Record<string, unknown>;
    manifestYaml: string;
  }) => void;
  setEditorSessionId: (id: string) => void;
}

export function useProjectGenerationFlow(
  options: UseProjectGenerationFlowOptions,
): UseProjectGenerationFlowReturn {
  const [isLoading, setIsLoading] = useState(false);

  const execute = useCallback(
    async (
      config: ProjectConfig,
      savedManifestYaml?: string | null,
    ): Promise<GenerationOutcome> => {
      setIsLoading(true);
      try {
        let manifest: Record<string, unknown>;
        // For an imported project the VALIDATED ORIGINAL text is what gets
        // persisted after generation — the server's emitted manifest.yaml is a
        // re-serialization that can drop comments/formatting, and overwriting
        // the stored manifest with it would erode the source of truth on every
        // generate.
        let importedYamlToPersist: string | null = null;
        if (isImportedFormState(config)) {
          // Manifest-first project: the stored manifest is the source of truth.
          // A parse/schema failure aborts (fail closed) — silently falling back
          // to the wizard projection would regenerate a degraded project and
          // recreate the exact loss this guard exists to prevent.
          const parsed = parseImportedManifest(savedManifestYaml);
          if (!parsed.ok) {
            return { kind: "validation-error", errors: [parsed.message] };
          }
          manifest = parsed.manifest;
          importedYamlToPersist = savedManifestYaml ?? null;
        } else {
          manifest = wizardToManifest(
            config as Parameters<typeof wizardToManifest>[0],
          ) as unknown as Record<string, unknown>;
        }

        const response = await fetchWithCsrf("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ manifest }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          return {
            kind: "server-error",
            status: response.status,
            message: errorData.error || "Generation failed",
          };
        }

        const result = await response.json();

        if (!result.success) {
          return {
            kind: "validation-error",
            errors: [result.error || "Unknown error"],
          };
        }

        const manifestYaml =
          importedYamlToPersist ?? (result.files?.["manifest.yaml"] || "");
        // Await the persistence write before setting the active workspace, so
        // the workspace never references an uncommitted project.
        const projectId = await options.saveProject(
          config.governance?.workspaceName || "Untitled",
          config,
          manifestYaml,
        );

        if (!projectId) {
          return {
            kind: "network-error",
            message: "Failed to save the generated project.",
          };
        }

        options.setActiveWorkspace({
          projectId,
          name: config.governance?.workspaceName || "Untitled",
          isDirty: false,
          lastModifiedAt: Date.now(),
          wizardData: config as unknown as Record<string, unknown>,
          manifestYaml,
        });

        return {
          kind: "success",
          projectId,
          manifestYaml,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Network error";
        return { kind: "network-error", message };
      } finally {
        setIsLoading(false);
      }
    },
    [options],
  );

  return { isLoading, execute };
}
