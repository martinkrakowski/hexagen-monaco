"use client";

import { useState, useCallback, useRef } from "react";
import { logger } from "../../lib/structured-logger";

export type StagedPhase =
  | "idle"
  | "stage-0"
  | "stage-1"
  | "stage-2"
  | "stage-3"
  | "stage-4"
  | "stage-5"
  | "stage-6"
  | "complete"
  | "failed";

export interface StageProgress {
  stage: number;
  label: string;
  durationMs?: number;
  chunks: string[];
}

export interface SpecGenerationOptions {
  platform?: string;
  deployment?: string;
  additionalContext?: string;
  signal?: AbortSignal;
}

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

function stageToPhase(stage: number): StagedPhase {
  if (stage >= 0 && stage <= 6) return `stage-${stage}` as StagedPhase;
  return "idle";
}

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
  const [contextCount, setContextCount] = useState(0);
  const [portCount, setPortCount] = useState(0);
  const [adapterCount, setAdapterCount] = useState(0);

  const abortRef = useRef<AbortController | null>(null);

  const handleEvent = useCallback((event: Record<string, unknown>) => {
    const type = event.type as string;

    if (type === "stage-start") {
      const stage = event.stage as number;
      const label =
        (event.label as string) || STAGE_LABELS[stage] || `Stage ${stage}`;
      setPhase(stageToPhase(stage));
      setStepDetail(`${label}...`);
      setStageProgress((prev) => ({
        ...prev,
        [stage]: { stage, label, chunks: [] },
      }));
    } else if (type === "stage-complete") {
      const stage = event.stage as number;
      const durationMs = event.durationMs as number;
      setStageProgress((prev) => ({
        ...prev,
        [stage]: { ...prev[stage], durationMs },
      }));
    } else if (type === "chunk") {
      const stage = event.stage as number;
      const data = event.data as string;
      setStageProgress((prev) => ({
        ...prev,
        [stage]: {
          ...prev[stage],
          chunks: [...(prev[stage]?.chunks || []), data],
        },
      }));
    } else if (type === "validation-error") {
      const errors = event.errors as string[];
      setValidationErrors(errors);
    } else if (type === "done") {
      setGeneratedManifest(event.yaml as string);
      setContextCount(event.contextCount as number);
      setPortCount(event.portCount as number);
      setAdapterCount(event.adapterCount as number);
      setPhase("complete");
      setStepDetail("Manifest generation complete");
      setIsGenerating(false);
    } else if (type === "error") {
      setGenerationError(event.message as string);
      setPhase("failed");
      setIsGenerating(false);
    }
  }, []);

  const generateFromSpec = useCallback(
    async (config: string, options?: SpecGenerationOptions) => {
      setGenerationError(null);
      setGeneratedManifest(null);
      setPhase("stage-0");
      setStepDetail("Starting structured config generation...");
      setStageProgress({});
      setValidationErrors([]);
      setContextCount(0);
      setPortCount(0);
      setAdapterCount(0);
      setIsGenerating(true);

      const controller = new AbortController();
      abortRef.current = controller;
      if (options?.signal) {
        options.signal.addEventListener("abort", () => controller.abort());
      }

      try {
        const response = await fetch("/api/manifest/generate/spec", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            config,
            platform: options?.platform,
            deployment: options?.deployment,
            additionalContext: options?.additionalContext,
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const text = await response.text();
          throw new Error(text || `HTTP ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              handleEvent(JSON.parse(line));
            } catch {
              logger.warn("[spec-gen] Failed to parse NDJSON line", { line });
            }
          }
        }

        if (buffer.trim()) {
          try {
            handleEvent(JSON.parse(buffer));
          } catch {
            void buffer;
          }
        }
      } catch (error) {
        if (controller.signal.aborted) {
          logger.info("[spec-gen] Generation aborted");
          setPhase("idle");
          setIsGenerating(false);
          return;
        }
        const message =
          error instanceof Error ? error.message : "Unknown error";
        logger.error(`[spec-gen] Failed: ${message}`);
        setGenerationError(message);
        setPhase("failed");
      } finally {
        setIsGenerating(false);
        abortRef.current = null;
      }
    },
    [handleEvent],
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
    setContextCount(0);
    setPortCount(0);
    setAdapterCount(0);
  }, []);

  return {
    generateFromSpec,
    isGenerating,
    generationError,
    generatedManifest,
    phase,
    stepDetail,
    stageProgress,
    validationErrors,
    contextCount,
    portCount,
    adapterCount,
    reset,
  };
}
