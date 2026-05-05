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

export interface UseStagedManifestGenerationReturn {
  generateManifest: (description: string, options?: {
    platform?: string;
    deployment?: string;
    additionalContext?: string;
    preferLocal?: boolean;
    signal?: AbortSignal;
  }) => Promise<void>;
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
  0: "Prompt Normalization",
  1: "Domain Extraction",
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

export function useStagedManifestGeneration(): UseStagedManifestGenerationReturn {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generatedManifest, setGeneratedManifest] = useState<string | null>(null);
  const [phase, setPhase] = useState<StagedPhase>("idle");
  const [stepDetail, setStepDetail] = useState("");
  const [stageProgress, setStageProgress] = useState<Record<number, StageProgress>>({});
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [contextCount, setContextCount] = useState(0);
  const [portCount, setPortCount] = useState(0);
  const [adapterCount, setAdapterCount] = useState(0);

  const abortRef = useRef<AbortController | null>(null);

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
        // Choose endpoint based on provider: local browser LLM or cloud
        const endpoint = options?.preferLocal
          ? "/api/manifest/generate/local"
          : "/api/manifest/generate/stage";
        
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description,
            platform: options?.platform,
            deployment: options?.deployment,
            additionalContext: options?.additionalContext,
            preferLocal: options?.preferLocal,
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

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line);
              handleEvent(event);
            } catch {
              logger.warn("[staged-gen] Failed to parse NDJSON line", { line });
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
          logger.info("[staged-gen] Generation aborted");
          setPhase("idle");
          setIsGenerating(false);
          return;
        }
        const message = error instanceof Error ? error.message : "Unknown error";
        logger.error(`[staged-gen] Failed: ${message}`);
        setGenerationError(message);
        setPhase("failed");
      } finally {
        setIsGenerating(false);
        abortRef.current = null;
      }
    },
    [],
  );

  const handleEvent = useCallback(
    (event: Record<string, unknown>) => {
      const type = event.type as string;

      if (type === "stage-start") {
        const stage = event.stage as number;
        const label = (event.label as string) || STAGE_LABELS[stage] || `Stage ${stage}`;
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
    },
    [],
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
    generateManifest,
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
