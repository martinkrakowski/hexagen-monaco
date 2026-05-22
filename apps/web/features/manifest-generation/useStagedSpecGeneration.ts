"use client";

import { useState, useEffect, useRef } from "react";
import type { StagedPhase, StageProgress } from "./staged-generation-types";
import { useStagedGenerationStream } from "./useStagedGenerationStream";
import type { PullRequestMetadata } from "@hexagen/external-integration";
import type { AssembledManifest } from "@hexagen/shared";
import {
  getClientSpecGenerationUseCase,
  isLocalLLMReady,
  hasServerLLMAccessKey,
} from "../../app/lib/wire.client";
import type { StageTelemetry } from "@hexagen/agentic-interaction";

export interface SpecGenerationOptions {
  platform?: string;
  deployment?: string;
  additionalContext?: string;
  executionStrategy?: "auto" | "local" | "cloud";
  signal?: AbortSignal;
}

export function resolveExecutionStrategy(
  strategy: "auto" | "local" | "cloud",
  hasLocalLLM: boolean,
  hasCloudKeys: boolean,
): "local" | "cloud" | "none" {
  if (strategy === "local") return hasLocalLLM ? "local" : "none";
  if (strategy === "cloud") return hasCloudKeys ? "cloud" : "none";
  if (hasLocalLLM) return "local";
  if (hasCloudKeys) return "cloud";
  return "none";
}

export interface UseStagedSpecGenerationReturn {
  generateFromSpec: (
    config: string,
    options?: SpecGenerationOptions,
  ) => Promise<
    | {
        generatedManifest: string | null;
        phase: StagedPhase;
        stepDetail: string;
        stageProgress: Record<number, StageProgress>;
        validationErrors: string[];
        contextCount: number;
        portCount: number;
        adapterCount: number;
      }
    | undefined
  >;
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

export function useStagedSpecGeneration(): UseStagedSpecGenerationReturn {
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

  const abortRef = useRef(false);
  const generatingLockRef = useRef(false);
  useEffect(() => {
    abortRef.current = false;
    return () => {
      abortRef.current = true;
    };
  }, []);
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

  const reset = () => {
    stream.reset();
    generatingLockRef.current = false;
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
  };

  const generateFromSpec = async (
    config: string,
    options?: SpecGenerationOptions,
  ) => {
    // Prevent concurrent calls — multiple listeners on the singleton WebLLM
    // Worker cause every token to be received N times (tripled output).
    if (generatingLockRef.current) {
      return undefined;
    }
    generatingLockRef.current = true;

    setGenerationError(null);
    setGeneratedManifest(null);
    setPhase("stage-0");
    setStepDetail("Starting config generation...");
    setStageProgress({});
    setValidationErrors([]);
    setVerboseLog([]);
    setContextCount(0);
    setPortCount(0);
    setAdapterCount(0);
    setIsGenerating(true);

    const controller = new AbortController();
    if (options?.signal) {
      options.signal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
    }

    const executeCloudGeneration = async () => {
      setGenerationError(null);
      setPhase("stage-0");
      const result = await stream.generate(
        {
          config,
          platform: options?.platform,
          deployment: options?.deployment,
          additionalContext: options?.additionalContext,
        },
        controller.signal,
      );

      if (abortRef.current || controller.signal.aborted) {
        return {
          phase: "failed" as StagedPhase,
          generationError: "Aborted",
          generatedManifest: null,
          stepDetail: "Aborted",
          stageProgress: {},
          validationErrors: [],
          contextCount: 0,
          portCount: 0,
          adapterCount: 0,
        };
      }

      setGeneratedManifest(result.generatedManifest);
      setContextCount(result.contextCount);
      setPortCount(result.portCount);
      setAdapterCount(result.adapterCount);
      setPhase(result.phase);
      setStepDetail(result.stepDetail);
      setStageProgress(result.stageProgress);
      setValidationErrors(result.validationErrors);
      if (result.phase === "failed") {
        setGenerationError(result.stepDetail || "Generation failed");
      }

      return result;
    };

    const strategy = options?.executionStrategy ?? "auto";
    const hasLocalLLM = isLocalLLMReady();
    const hasCloudKeys = hasServerLLMAccessKey();
    const resolved = resolveExecutionStrategy(
      strategy,
      hasLocalLLM,
      hasCloudKeys,
    );

    try {
      if (resolved === "none") {
        setGenerationError(
          "No LLM provider available. Configure an API key or load a local model in Settings.",
        );
        setPhase("failed");
        setIsGenerating(false);
        return {
          phase: "failed" as StagedPhase,
          generationError: "No LLM provider available",
          generatedManifest: null,
          stepDetail: "No LLM provider available",
          stageProgress: {},
          validationErrors: [],
          contextCount: 0,
          portCount: 0,
          adapterCount: 0,
        };
      }

      if (resolved === "local") {
        try {
          const useCase = getClientSpecGenerationUseCase();

          setPhase("stage-0");
          setStepDetail("Parsing Configuration...");
          // Yield to the event loop so React commits the "Parsing Configuration"
          // state update before the synchronous execution of stages 0–2 inside
          // useCase.execute() batches further updates. Without this yield, the user
          // sees a blank or stale UI until stage 3's LLM call yields the event loop.
          await new Promise((r) => setTimeout(r, 0));

          const isCancelled = () =>
            abortRef.current || controller.signal.aborted;

          const result = await useCase.execute(config, {
            onProgress: (stage: number, durationMs: number) => {
              if (isCancelled()) return;
              setPhase(`stage-${stage}` as StagedPhase);
              setStepDetail(STAGE_LABELS[stage] ?? `Stage ${stage}`);
              setStageProgress((prev) => {
                const existing = prev[stage] ?? {
                  stage,
                  label: "",
                  durationMs: 0,
                  chunks: [],
                  completed: false,
                };
                return {
                  ...prev,
                  [stage]: {
                    ...existing,
                    label: STAGE_LABELS[stage] ?? `Stage ${stage}`,
                    durationMs:
                      durationMs > 0 ? durationMs : existing.durationMs,
                    completed: durationMs > 0,
                  },
                };
              });
            },
            onError: (stage: number, error: string, durationMs?: number) => {
              if (isCancelled()) return;
              setGenerationError(error);
              setPhase("failed");
              setStepDetail(`Error in ${STAGE_LABELS[stage]}: ${error}`);
              if (durationMs) {
                setStageProgress((prev) => ({
                  ...prev,
                  [stage]: {
                    stage,
                    label: STAGE_LABELS[stage] ?? `Stage ${stage}`,
                    durationMs,
                    error,
                    chunks: [],
                    completed: true,
                  },
                }));
              }
            },
            onChunk: (message: string) => {
              if (isCancelled()) return;
              setVerboseLog((prev) => [...prev, message]);
            },
            onStageTelemetry: (telemetry: StageTelemetry) => {
              if (isCancelled()) return;
              setStageProgress((prev) => ({
                ...prev,
                [telemetry.stage]: {
                  stage: telemetry.stage,
                  label:
                    STAGE_LABELS[telemetry.stage] ?? `Stage ${telemetry.stage}`,
                  durationMs: telemetry.durationMs,
                  chunks: [],
                  completed: true,
                  telemetry,
                },
              }));
            },
          });

          if (abortRef.current || controller.signal.aborted) {
            return {
              phase: "failed" as StagedPhase,
              generationError: "Aborted",
              generatedManifest: null,
              stepDetail: "Aborted",
              stageProgress: {},
              validationErrors: [],
              contextCount: 0,
              portCount: 0,
              adapterCount: 0,
            };
          }

          if (result.success) {
            const yaml = result.value.yaml || "";
            const parsed =
              (result.value.parsedObject as Record<string, unknown>) || {};
            const ctxCount = Array.isArray(parsed.bounded_contexts)
              ? parsed.bounded_contexts.length
              : 0;
            const ptCount = Array.isArray(parsed.context_mappings)
              ? parsed.context_mappings.length
              : 0;
            const adpCount = Array.isArray(parsed.bounded_contexts)
              ? (
                  parsed.bounded_contexts as Array<Record<string, unknown>>
                ).reduce(
                  (sum, ctx) =>
                    sum +
                    (Array.isArray(ctx.adapters) ? ctx.adapters.length : 0),
                  0,
                )
              : 0;

            setGeneratedManifest(yaml);
            setContextCount(ctxCount);
            setPortCount(ptCount);
            setAdapterCount(adpCount);
            setPhase("complete");
            setStepDetail("Manifest generation complete");

            return {
              phase: "complete" as StagedPhase,
              generatedManifest: yaml,
              stepDetail: "Manifest generation complete",
              stageProgress: {},
              validationErrors: [],
              contextCount: ctxCount,
              portCount: ptCount,
              adapterCount: adpCount,
            };
          }

          if (hasCloudKeys) {
            return await executeCloudGeneration();
          }

          throw result.error;
        } catch (localError: unknown) {
          if (abortRef.current || controller.signal.aborted) {
            return {
              phase: "failed" as StagedPhase,
              generationError: "Aborted",
              generatedManifest: null,
              stepDetail: "Aborted",
              stageProgress: {},
              validationErrors: [],
              contextCount: 0,
              portCount: 0,
              adapterCount: 0,
            };
          }
          if (hasCloudKeys) {
            return await executeCloudGeneration();
          }
          throw localError;
        }
      }

      return await executeCloudGeneration();
    } catch (error) {
      if (abortRef.current || controller.signal.aborted) {
        return {
          phase: "failed" as StagedPhase,
          generationError: "Aborted",
          generatedManifest: null,
          stepDetail: "Aborted",
          stageProgress: {},
          validationErrors: [],
          contextCount: 0,
          portCount: 0,
          adapterCount: 0,
        };
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      setGenerationError(message);
      setPhase("failed");
      return {
        phase: "failed" as StagedPhase,
        generationError: message,
        generatedManifest: null,
        stepDetail: message,
        stageProgress: {},
        validationErrors: [],
        contextCount: 0,
        portCount: 0,
        adapterCount: 0,
      };
    } finally {
      generatingLockRef.current = false;
      if (!abortRef.current && !controller.signal.aborted) {
        setIsGenerating(false);
      }
    }
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
    proposePR,
    isProposing: prState.isProposing,
    prMetadata: prState.prMetadata,
    proposeError: prState.error,
  };
}
