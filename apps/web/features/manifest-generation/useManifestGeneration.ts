/**
 * Unified hook for manifest generation from natural language.
 * Supports both local (WebLLM) and server (API) generation modes.
 */

import { useState, useCallback, useEffect } from "react";
import type { GeneratedManifest } from "@hexagen/agentic-interaction";
import { getClientManifestGenerationUseCase } from "../../app/lib/wire";
import { getServerManifestGenerationUseCase } from "../../app/lib/wire";

interface GenerationState {
  status: "idle" | "generating" | "success" | "error";
  result: GeneratedManifest | null;
  error: string | null;
  retryCount: number;
}

export type ManifestGenerationMode = "local" | "server";

export interface UseManifestGenerationOptions {
  mode?: ManifestGenerationMode;
  modelId?: string;
}

export function useManifestGeneration() {
  const [state, setState] = useState<GenerationState>({
    status: "idle",
    result: null,
    error: null,
    retryCount: 0,
  });

  const [abortController, setAbortController] = useState<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortController?.abort();
    };
  }, [abortController]);

  const generate = useCallback(
    async (description: string, options?: UseManifestGenerationOptions) => {
      const controller = new AbortController();
      setAbortController(controller);

      setState({
        status: "generating",
        result: null,
        error: null,
        retryCount: 0,
      });

      const mode = options?.mode ?? "server";

      if (mode === "local") {
        const useCase = getClientManifestGenerationUseCase();
        try {
          const topologyResult = await useCase.generateTopology(
            { description },
            controller.signal,
          );

          if (!topologyResult.ok) {
            setState({
              status: "error",
              result: null,
              error: topologyResult.error,
              retryCount: 0,
            });
            return;
          }

          const triggers = useCase.checkClarificationTriggers(topologyResult.topology);
          if (triggers.length > 0) {
            setState({
              status: "error",
              result: null,
              error: `Clarification needed: ${triggers.map(t => t.message).join(", ")}`,
              retryCount: 0,
            });
            return;
          }

          const adaptersResult = await useCase.extractAdapters(
            topologyResult.topology,
            controller.signal,
          );

          if (!adaptersResult.ok) {
            setState({
              status: "error",
              result: null,
              error: adaptersResult.error,
              retryCount: 0,
            });
            return;
          }

          const { yaml, diagnostics } = await useCase.renderManifest(
            adaptersResult.draft,
            controller.signal,
          );

          const generatedManifest: GeneratedManifest = {
            manifest: yaml,
            confidence: 0.8,
            suggestions: [],
            warnings: diagnostics.map(d => d.message),
            metadata: {
              model: options?.modelId ?? "local",
              processingTime: 0,
              tokensUsed: 0,
              provider: "local",
            },
          };

          setState({
            status: "success",
            result: generatedManifest,
            error: null,
            retryCount: 0,
          });
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            setState({
              status: "idle",
              result: null,
              error: null,
              retryCount: 0,
            });
            return;
          }
          setState({
            status: "error",
            result: null,
            error: error instanceof Error ? error.message : "Unknown error",
            retryCount: 0,
          });
        }
      } else {
        const useCase = getServerManifestGenerationUseCase();
        try {
          const response = await useCase.execute(description, {
            mode,
            modelId: options?.modelId,
          });

          if (response.ok) {
            setState({
              status: "success",
              result: response.result,
              error: null,
              retryCount: 0,
            });
          } else {
            setState({
              status: "error",
              result: null,
              error: response.error,
              retryCount: 0,
            });
          }
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            setState({
              status: "idle",
              result: null,
              error: null,
              retryCount: 0,
            });
            return;
          }
          setState({
            status: "error",
            result: null,
            error: error instanceof Error ? error.message : "Unknown error",
            retryCount: 0,
          });
        }
      }
    },
    [],
  );

  const reset = useCallback(() => {
    abortController?.abort();
    setState({
      status: "idle",
      result: null,
      error: null,
      retryCount: 0,
    });
  }, [abortController]);

  return {
    ...state,
    generate,
    reset,
    isGenerating: state.status === "generating",
    isSuccess: state.status === "success",
    isError: state.status === "error",
  };
}