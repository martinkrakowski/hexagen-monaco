"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { logger } from "../../lib/structured-logger";
import type { ClientManifestGenerationUseCase } from "@hexagen/manifest-generation";
import type {
  ClientManifestGenerationTopologyResult,
  ClientManifestGenerationAdaptersResult,
} from "@hexagen/manifest-generation";
import type { ManifestDraftContext } from "@hexagen/agentic-interaction";
import { getClientManifestGenerationUseCase } from "../../app/lib/wire.client";
import type { StagedPhase, StageProgress } from "./staged-generation-types";
import { useStagedGenerationStream } from "./useStagedGenerationStream";

/** Return type of the useStagedManifestGeneration hook */
export interface UseStagedManifestGenerationReturn {
  generateManifest: (
    description: string,
    options?: {
      platform?: string;
      deployment?: string;
      additionalContext?: string;
      preferLocal?: boolean;
      signal?: AbortSignal;
    },
  ) => Promise<{
    phase: StagedPhase;
    generatedManifest?: string | null;
    generationError?: string | null;
  } | void>;
  isGenerating: boolean;
  generationError: string | null;
  generatedManifest: string | null;
  phase: StagedPhase;
  stepDetail: string;
  stageProgress: Record<number, StageProgress>;
  verboseLog: string[];
  validationErrors: string[];
  contextCount: number;
  portCount: number;
  adapterCount: number;
  reset: () => void;
}

const STAGE_LABELS: Record<number, string> = {
  0: "Prompt Normalization",
  1: "Domain Extraction",
  2: "Context Classification",
  3: "Port Mapping",
  4: "Adapter Assignment",
  5: "Manifest Assembly",
  6: "Validation Review",
};

/**
 * Hook that manages manifest generation with SSE streaming.
 * Supports both local WebLLM and cloud LLM paths with per-stage progress tracking.
 */
export function useStagedManifestGeneration(): UseStagedManifestGenerationReturn {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generatedManifest, setGeneratedManifest] = useState<string | null>(
    null,
  );
  const [phase, setPhase] = useState<StagedPhase>("idle");
  const [stepDetail, setStepDetail] = useState("");
  const [stageProgress, setStageProgress] = useState<
    Record<number, StageProgress>
  >({});
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [verboseLog, setVerboseLog] = useState<string[]>([]);
  const [contextCount, setContextCount] = useState(0);
  const [portCount, setPortCount] = useState(0);
  const [adapterCount, setAdapterCount] = useState(0);

  const abortRef = useRef<AbortController | null>(null);

  // Cloud streaming hook
  const cloudStream = useStagedGenerationStream({
    endpoint: "/api/manifest/generate/stage",
    stageLabels: STAGE_LABELS,
  });

  // While the cloud stream is active, mirror its phase / stepDetail /
  // stageProgress into this hook's state so the UI updates live instead of
  // only after cloudStream.generate() resolves. Unlike the spec endpoint
  // (curated status text at stage -1), the staged endpoint streams raw LLM
  // tokens at the real stage number, so the verbose log is built by grouping +
  // joining each stage's chunks in order — tokens read as text, not one
  // fragment per line.
  useEffect(() => {
    if (!cloudStream.isGenerating) return;
    setPhase(cloudStream.phase);
    if (cloudStream.stepDetail) setStepDetail(cloudStream.stepDetail);
    setStageProgress(cloudStream.stageProgress);

    const log: string[] = [];
    for (const key of Object.keys(cloudStream.stageProgress)
      .map(Number)
      .filter((n) => n >= 0)
      .sort((a, b) => a - b)) {
      const sp = cloudStream.stageProgress[key];
      if (!sp?.chunks?.length) continue;
      log.push(`Stage ${key}${sp.label ? ` — ${sp.label}` : ""}`);
      for (const line of sp.chunks.join("").split("\n")) log.push(line);
    }
    if (log.length) setVerboseLog(log);
  }, [
    cloudStream.isGenerating,
    cloudStream.phase,
    cloudStream.stepDetail,
    cloudStream.stageProgress,
  ]);

  const generateManifest = useCallback(
    async (
      description: string,
      options?: {
        platform?: string;
        deployment?: string;
        additionalContext?: string;
        preferLocal?: boolean;
        signal?: AbortSignal;
      },
    ) => {
      setGenerationError(null);
      setGeneratedManifest(null);
      setPhase("stage-0");
      setStepDetail("Starting staged generation...");
      setStageProgress({});
      setValidationErrors([]);
      setVerboseLog([]);
      setContextCount(0);
      setPortCount(0);
      setAdapterCount(0);
      setIsGenerating(true);

      const controller = new AbortController();
      abortRef.current = controller;
      if (options?.signal) {
        options.signal.addEventListener("abort", () => controller.abort(), {
          once: true,
        });
      }

      try {
        // Route based on provider: client-side WebLLM or server cloud
        if (options?.preferLocal) {
          // WebLLM: run client-side use case directly (no HTTP call)
          const useCase =
            getClientManifestGenerationUseCase() as unknown as ClientManifestGenerationUseCase;

          // Step 1: Generate topology
          setPhase("stage-0");
          setStepDetail("Analyzing project structure...");
          const topologyResult = await useCase.generateTopology(
            {
              description,
              maxContexts: 50,
            },
            controller.signal,
            (detail) => setStepDetail(detail),
          );

          if (!topologyResult.ok) {
            throw new Error(String(topologyResult.error));
          }

          // Emit topology completion event
          setPhase("stage-1");
          setStepDetail("Topology generation complete");
          const topology = (
            topologyResult as ClientManifestGenerationTopologyResult
          ).topology;

          // Step 2: Extract adapters (adds adapters[] to each context)
          setPhase("stage-4");
          setStepDetail("Extracting adapters...");
          const adaptersResult = await useCase.extractAdapters(
            topology,
            controller.signal,
            (detail) => setStepDetail(detail),
          );

          if (!adaptersResult.ok) {
            throw new Error(String(adaptersResult.error));
          }

          const draft = (
            adaptersResult as ClientManifestGenerationAdaptersResult
          ).draft;

          // Step 3: Render manifest
          setPhase("stage-6");
          setStepDetail("Rendering manifest...");
          const renderResult = await useCase.renderManifest(
            draft,
            controller.signal,
          );

          // Success
          const yaml = renderResult.yaml || "";
          const adapterCount = draft.boundedContexts.reduce(
            (sum: number, c: ManifestDraftContext) =>
              sum + (c.adapters?.length || 0),
            0,
          );

          const contextCount = draft.boundedContexts.length;
          const portCount = draft.boundedContexts.reduce(
            (sum: number, c: ManifestDraftContext) =>
              sum + (c.ports?.in?.length || 0) + (c.ports?.out?.length || 0),
            0,
          );

          setGeneratedManifest(yaml);
          setContextCount(contextCount);
          setPortCount(portCount);
          setAdapterCount(adapterCount);
          setPhase("complete");
          setStepDetail("Manifest generation complete");
          setIsGenerating(false);

          return {
            phase: "complete" as StagedPhase,
            generatedManifest: yaml,
          };
        } else {
          // Cloud: call server endpoint (staged generation with cloud keys)
          const result = await cloudStream.generate(
            {
              description,
              platform: options?.platform,
              deployment: options?.deployment,
              additionalContext: options?.additionalContext,
              preferLocal: options?.preferLocal,
            },
            controller.signal,
          );

          // Use returned values from generate() instead of stale closure
          setGeneratedManifest(result.generatedManifest);
          setContextCount(result.contextCount);
          setPortCount(result.portCount);
          setAdapterCount(result.adapterCount);
          setPhase(result.phase);
          setStepDetail(result.stepDetail);
          setStageProgress(result.stageProgress);
          setValidationErrors(result.validationErrors);

          return {
            phase: result.phase as StagedPhase,
            generatedManifest: result.generatedManifest,
            generationError:
              result.phase === "failed" ? result.stepDetail : null,
          };
        }
      } catch (error) {
        if (controller.signal.aborted) {
          logger.info("[staged-gen] Generation aborted");
          setPhase("idle");
          setIsGenerating(false);
          return;
        }
        const message =
          error instanceof Error ? error.message : "Unknown error";
        logger.error(`[staged-gen] Failed: ${message}`);
        setGenerationError(message);
        setPhase("failed");
        return {
          phase: "failed" as StagedPhase,
          generationError: message,
        };
      } finally {
        if (!controller.signal.aborted) {
          setIsGenerating(false);
        }
        abortRef.current = null;
      }
    },
    [cloudStream],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setIsGenerating(false);
    setGenerationError(null);
    setGeneratedManifest(null);
    setPhase("idle");
    setStepDetail("");
    setStageProgress({});
    setValidationErrors([]);
    setVerboseLog([]);
    setContextCount(0);
    setPortCount(0);
    setAdapterCount(0);
    cloudStream.reset();
  }, [cloudStream]);

  return {
    generateManifest,
    isGenerating,
    generationError,
    generatedManifest,
    phase,
    stepDetail,
    stageProgress,
    verboseLog,
    validationErrors,
    contextCount,
    portCount,
    adapterCount,
    reset,
  };
}
