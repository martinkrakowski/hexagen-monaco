import { useCallback, useState } from "react";
import type { ProjectConfig } from "@hexagen/project-configuration";
import { wizardToManifest } from "@/lib/wizard-to-manifest";

export type GenerationOutcome =
  | { kind: "success"; projectId: string; manifestYaml: string }
  | { kind: "validation-error"; errors: string[] }
  | { kind: "network-error"; message: string }
  | { kind: "server-error"; status: number; message: string };

export interface UseProjectGenerationFlowReturn {
  isLoading: boolean;
  execute: (config: ProjectConfig) => Promise<GenerationOutcome>;
}

interface UseProjectGenerationFlowOptions {
  saveProject: (
    name: string,
    formState: ProjectConfig,
    manifestYaml: string,
  ) => string;
  clearDraft: () => Promise<void>;
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
    async (config: ProjectConfig): Promise<GenerationOutcome> => {
      setIsLoading(true);
      try {
        const manifest = wizardToManifest(
          config as Parameters<typeof wizardToManifest>[0],
        );

        const response = await fetch("/api/generate", {
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

        const manifestYaml = result.files?.["manifest.yaml"] || "";
        const projectId = options.saveProject(
          config.governance?.workspaceName || "Untitled",
          config,
          manifestYaml,
        );

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
