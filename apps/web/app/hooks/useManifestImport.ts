import { useCallback } from "react";
import { buildWizardData } from "@/lib/compose-wizard-data";
import type { ProjectConfig } from "@hexagen/project-configuration";
import type {
  WizardData,
  BoundedContext,
  ExternalContext,
  PeerMapping,
} from "@hexagen/shared";

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
        const manifest = JSON.parse(yamlContent);

        const boundedContexts: BoundedContext[] =
          (manifest.boundedContexts as BoundedContext[]) || [];
        const externalContexts: ExternalContext[] =
          (manifest.externalContexts as ExternalContext[]) || [];
        const peerMappings: PeerMapping[] =
          (manifest.peerMappings as PeerMapping[]) || [];

        const wizardData = buildWizardData(
          boundedContexts,
          externalContexts,
          peerMappings,
        );

        const formValues: ProjectConfig = {
          ...wizardData,
          governance: wizardData.governance,
        } as ProjectConfig;

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
