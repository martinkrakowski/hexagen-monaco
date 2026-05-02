import { useState, useCallback } from "react";
import { parseManifestToWizardData } from "@hexagen/wizard-orchestration";
import type { WizardData } from "@hexagen/project-configuration";

interface ManifestParserState {
  status: "idle" | "parsing" | "success" | "error";
  result: WizardData | null;
  error: string | null;
}

interface UseManifestParserReturn {
  status: ManifestParserState["status"];
  result: WizardData | null;
  error: string | null;
  parseManifest: (yamlString: string) => void;
  reset: () => void;
}

/**
 * Hook for parsing manifest YAML strings into WizardData structure
 * Provides parsing functionality with error handling and loading states
 */
export function useManifestParser(): UseManifestParserReturn {
  const [state, setState] = useState<ManifestParserState>({
    status: "idle",
    result: null,
    error: null,
  });

  const parseManifest = useCallback(async (yamlString: string) => {
    setState({ status: "parsing", result: null, error: null });

    try {
      const wizardData = parseManifestToWizardData(yamlString);
      setState({ status: "success", result: wizardData, error: null });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to parse manifest";
      setState({
        status: "error",
        result: null,
        error: errorMessage,
      });
    }
  }, []);

  const reset = useCallback(() => {
    setState({ status: "idle", result: null, error: null });
  }, []);

  return {
    ...state,
    parseManifest,
    reset,
  };
}
