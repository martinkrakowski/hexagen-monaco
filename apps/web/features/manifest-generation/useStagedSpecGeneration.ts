"use client";

import { useState } from "react";
import type { StagedPhase, StageProgress } from "./staged-generation-types";
import { useStagedGenerationStream } from "./useStagedGenerationStream";
import type { PullRequestMetadata } from "@hexagen/external-integration";
import type { AssembledManifest } from "@hexagen/shared";

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
  proposePR: (
    manifest: AssembledManifest,
    intent: string,
  ) => Promise<{ ok: boolean; value?: PullRequestMetadata; error?: Error }>;
  isProposing: boolean;
  prMetadata: PullRequestMetadata | null;
  proposeError: Error | null;
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

  const [prState, setPrState] = useState<{
    isProposing: boolean;
    prMetadata: PullRequestMetadata | null;
    error: Error | null;
  }>({
    isProposing: false,
    prMetadata: null,
    error: null,
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

  const proposePR = async (manifest: AssembledManifest, intent: string) => {
    setPrState((prev) => ({ ...prev, isProposing: true, error: null }));

    try {
      const response = await fetch("/api/gitops/propose-pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manifest, intent }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error ?? "Failed to create PR");
      }

      setPrState({
        isProposing: false,
        prMetadata: result,
        error: null,
      });

      return { ok: true as const, value: result };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      setPrState((prev) => ({ ...prev, isProposing: false, error: err }));
      return { ok: false as const, error: err };
    }
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
    proposePR,
    isProposing: prState.isProposing,
    prMetadata: prState.prMetadata,
    proposeError: prState.error,
  };
}
