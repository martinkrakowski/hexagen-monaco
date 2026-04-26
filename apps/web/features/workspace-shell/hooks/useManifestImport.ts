import { useCallback } from "react";
import yaml from "js-yaml";
import { buildWizardData } from "@/lib/compose-wizard-data";
import type { ProjectConfig, WizardData } from "@hexagen/project-configuration";
import { emptyFormValues } from "../../project-wizard/config";

export type ManifestImportOutcome =
  | { kind: "success"; wizardData: WizardData; formValues: ProjectConfig }
  | { kind: "parse-error"; message: string };

export interface UseManifestImportReturn {
  importManifest: (yamlContent: string) => Promise<ManifestImportOutcome>;
}

export function useManifestImport(): UseManifestImportReturn {
  const importManifest = useCallback(
    async (yamlContent: string): Promise<ManifestImportOutcome> => {
      try {
        // Parse as YAML (not JSON) — manifests are .yaml files
        const manifest = yaml.load(yamlContent) as Record<string, unknown>;

        const formValues: ProjectConfig = {
          boundedContexts:
            (manifest.boundedContexts as ProjectConfig["boundedContexts"]) ??
            [],
          externalContexts:
            (manifest.externalContexts as ProjectConfig["externalContexts"]) ??
            [],
          peerMappings:
            (manifest.peerMappings as ProjectConfig["peerMappings"]) ?? [],
          governance:
            (manifest.governance as ProjectConfig["governance"]) ??
            emptyFormValues.governance,
        };

        const wizardData = buildWizardData(
          formValues.boundedContexts,
          formValues.externalContexts,
          formValues.peerMappings,
          formValues.governance,
        );

        return {
          kind: "success",
          wizardData,
          formValues,
        };
      } catch (error) {
        return {
          kind: "parse-error",
          message: error instanceof Error ? error.message : "Parse error",
        };
      }
    },
    [],
  );

  return { importManifest };
}
