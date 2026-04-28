/**
 * Hook for managing manifest generation from natural language
 */

import { useState, useCallback } from "react";

interface GenerationMetadata {
  model: string;
  processingTime: number;
  tokensUsed: number;
}

interface GeneratedManifest {
  manifest: string;
  confidence: number;
  suggestions: string[];
  warnings: string[];
  metadata: GenerationMetadata;
}

interface GenerationState {
  status: "idle" | "generating" | "success" | "error";
  result: GeneratedManifest | null;
  error: string | null;
}

export function useManifestGeneration() {
  const [state, setState] = useState<GenerationState>({
    status: "idle",
    result: null,
    error: null,
  });

  const generate = useCallback(
    async (
      description: string,
      options?: {
        language?: string;
        platform?: string;
        deployment?: string;
        additionalContext?: string;
      },
    ) => {
      setState({ status: "generating", result: null, error: null });

      try {
        const response = await fetch("/api/manifest/generate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            description,
            ...options,
          }),
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
          setState({
            status: "error",
            result: null,
            error: data.error || data.details || "Failed to generate manifest",
          });
          return;
        }

        setState({
          status: "success",
          result: {
            manifest: data.manifest,
            confidence: data.confidence,
            suggestions: data.suggestions,
            warnings: data.warnings,
            metadata: data.metadata,
          },
          error: null,
        });
      } catch (error) {
        setState({
          status: "error",
          result: null,
          error: error instanceof Error ? error.message : "Network error",
        });
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setState({ status: "idle", result: null, error: null });
  }, []);

  return {
    ...state,
    generate,
    reset,
    isGenerating: state.status === "generating",
    isSuccess: state.status === "success",
    isError: state.status === "error",
  };
}

// Made with Bob
