"use client";

import type { StagedPhase, StageProgress } from "./staged-generation-types";
import { useStagedGenerationStream } from "./useStagedGenerationStream";

/** Optional parameters for structured config generation */
export interface SpecGenerationOptions {
  platform?: string;
  deployment?: string;
  additionalContext?: string;
  signal?: AbortSignal;
}

/** Return type of the useStagedSpecGeneration hook */
export interface UseStagedSpecGenerationReturn {
  generateFromSpec: (
    config: string,
    options?: SpecGenerationOptions,
  ) => Promise<void>;
  isGenerating: boolean;
  generationError: string | null;
  generatedManifest: string | null;
  phase: StagedPhase;
  stepDetail: string;
  stageProgress: Record<number, StageProgress>;
  validationErrors: string[];
  contextCount: number;
  portCount: number;
  adapterCount: number;
  reset: () => void;
}

const STAGE_LABELS: Record<number, string> = {
  0: "Config Parse",
  1: "Domain Analysis",
  2: "Context Classification",
  3: "Port Mapping",
  4: "Adapter Assignment",
  5: "Manifest Assembly",
  6: "Validation Review",
};

/**
 * Hook that manages structured config generation with SSE streaming.
 * Tracks per-stage progress, emits NDJSON events, and supports abort.
 */
export function useStagedSpecGeneration(): UseStagedSpecGenerationReturn {
  const stream = useStagedGenerationStream({
    endpoint: "/api/manifest/generate/spec",
    stageLabels: STAGE_LABELS,
  });

  const generateFromSpec = async (
    config: string,
    options?: SpecGenerationOptions,
  ) => {
    await stream.generate(
      {
        config,
        platform: options?.platform,
        deployment: options?.deployment,
        additionalContext: options?.additionalContext,
      },
      options?.signal,
    );
  };

  return {
    generateFromSpec,
    isGenerating: stream.isGenerating,
    generationError: stream.generationError,
    generatedManifest: stream.generatedManifest,
    phase: stream.phase,
    stepDetail: stream.stepDetail,
    stageProgress: stream.stageProgress,
    validationErrors: stream.validationErrors,
    contextCount: stream.contextCount,
    portCount: stream.portCount,
    adapterCount: stream.adapterCount,
    reset: stream.reset,
  };
}
