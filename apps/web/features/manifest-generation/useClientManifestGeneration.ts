"use client";

import { useState, useCallback, useRef } from "react";
import type { LocalLLMContext } from "../../lib/llm-interfaces";
import type {
  ManifestTopologyDraft,
  ClarificationTrigger,
  DraftDiagnostic,
} from "@hexagen/agentic-interaction";
import { getClientManifestGenerationUseCase } from "../../app/lib/wire";
import { logger } from "../../lib/structured-logger";

export type GenerationPhase =
  | "idle"
  | "topology"
  | "clarification_needed"
  | "adapters"
  | "rendering"
  | "complete"
  | "failed";

export interface UseClientManifestGenerationReturn {
  generateManifest: (
    description: string,
    signal?: AbortSignal,
    maxContexts?: number,
  ) => Promise<void>;
  isGenerating: boolean;
  generationError: string | null;
  generatedManifest: string | null;
  phase: GenerationPhase;
  stepDetail: string;
  clarificationTriggers: ClarificationTrigger[];
  partialTopology: ManifestTopologyDraft | null;
  confirmTopologyAndContinue: (signal?: AbortSignal) => Promise<void>;
  diagnostics: DraftDiagnostic[];
  reset: () => void;
}

export function useClientManifestGeneration(
  _llmContext: LocalLLMContext,
): UseClientManifestGenerationReturn {
  void _llmContext; // Wire only; use case is retrieved via DI
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generatedManifest, setGeneratedManifest] = useState<string | null>(
    null,
  );
  const [phase, setPhase] = useState<GenerationPhase>("idle");
  const [stepDetail, setStepDetail] = useState<string>("");
  const [clarificationTriggers, setClarificationTriggers] = useState<
    ClarificationTrigger[]
  >([]);
  const [partialTopology, setPartialTopology] =
    useState<ManifestTopologyDraft | null>(null);
  const [diagnostics, setDiagnostics] = useState<DraftDiagnostic[]>([]);

  const descriptionRef = useRef<string>("");

  const generateManifest = useCallback(
    async (description: string, signal?: AbortSignal, maxContexts?: number) => {
      if (signal?.aborted) {
        logger.info("[manifest-gen] Generation aborted before start");
        return;
      }

      logger.info(`[manifest-gen] Starting manifest generation`);
      setGenerationError(null);
      setGeneratedManifest(null);
      setPhase("topology");
      setStepDetail("Analyzing project structure...");
      setIsGenerating(true);
      descriptionRef.current = description;

      try {
        const useCase = getClientManifestGenerationUseCase();

        logger.info(
          `[manifest-gen] Building topology from description: "${description.slice(0, 100)}..."`,
        );

        const topologyResult = await useCase.generateTopology(
          { description, maxContexts },
          signal,
          setStepDetail,
        );

        if (!topologyResult.ok) {
          logger.error(
            `[manifest-gen] Topology build failed: ${topologyResult.error}`,
          );
          setGenerationError(topologyResult.error);
          setPhase("failed");
          setIsGenerating(false);
          return;
        }

        const topology = topologyResult.topology;

        const triggers = useCase.checkClarificationTriggers(topology);
        if (triggers.length > 0) {
          logger.info(
            `[manifest-gen] Clarification needed for ${triggers.length} issue(s)`,
          );
          setClarificationTriggers(triggers);
          setPartialTopology(topology);
          setPhase("clarification_needed");
          setIsGenerating(false);
          return;
        }

        logger.info(
          `[manifest-gen] Topology generation successful, proceeding to finalize`,
        );
        await finalizeGeneration(topology, signal);
      } catch (error) {
        if (signal?.aborted) {
          logger.info("[manifest-gen] Generation aborted");
          return;
        }
        const message =
          error instanceof Error
            ? error.message
            : "Failed to generate manifest";
        logger.error(`[manifest-gen] Manifest generation failed: ${message}`);
        setGenerationError(message);
        setPhase("failed");
        setIsGenerating(false);
      }
    },
    [],
  );

  const finalizeGeneration = useCallback(
    async (
      topology: ManifestTopologyDraft,
      signal?: AbortSignal,
    ) => {
      logger.info(
        `[manifest-gen] Finalizing generation for ${topology.boundedContexts.length} contexts`,
      );
      setPhase("adapters");
      setStepDetail(
        `Extracting adapters for ${topology.boundedContexts.length} contexts...`,
      );

      try {
        const useCase = getClientManifestGenerationUseCase();

        const adaptersResult = await useCase.extractAdapters(
          topology,
          signal,
          setStepDetail,
        );

        if (!adaptersResult.ok) {
          setGenerationError(adaptersResult.error);
          setPhase("failed");
          setIsGenerating(false);
          return;
        }

        setPhase("rendering");
        setStepDetail("Rendering manifest to YAML...");
        logger.info("[manifest-gen] Rendering manifest to YAML");

        const rendered = await useCase.renderManifest(
          adaptersResult.draft,
          signal,
        );

        logger.info(
          `[manifest-gen] Manifest rendering complete, ${rendered.diagnostics.length} diagnostic(s)`,
        );
        setStepDetail("Manifest generation complete");
        setGeneratedManifest(rendered.yaml);
        setDiagnostics([...rendered.diagnostics, ...adaptersResult.diagnostics]);
        setPhase("complete");
        setIsGenerating(false);
      } catch (error) {
        if (signal?.aborted) {
          logger.info("[manifest-gen] Finalization aborted");
          setIsGenerating(false);
          setPhase("idle");
          return;
        }
        const message =
          error instanceof Error ? error.message : "Failed to render manifest";
        logger.error(`[manifest-gen] Rendering failed: ${message}`);
        setGenerationError(message);
        setPhase("failed");
        setIsGenerating(false);
      }
    },
    [],
  );

  const confirmTopologyAndContinue = useCallback(
    async (signal?: AbortSignal) => {
      if (!partialTopology) return;
      setIsGenerating(true);
      try {
        await finalizeGeneration(partialTopology, signal);
      } catch (error) {
        if (signal?.aborted) return;
        const message =
          error instanceof Error
            ? error.message
            : "Failed to generate manifest";
        setGenerationError(message);
        setPhase("failed");
        setIsGenerating(false);
      }
    },
    [partialTopology, finalizeGeneration],
  );

  const reset = useCallback(() => {
    setIsGenerating(false);
    setGenerationError(null);
    setGeneratedManifest(null);
    setPhase("idle");
    setStepDetail("");
    setClarificationTriggers([]);
    setPartialTopology(null);
    setDiagnostics([]);
  }, []);

  return {
    generateManifest,
    isGenerating,
    generationError,
    generatedManifest,
    phase,
    stepDetail,
    clarificationTriggers,
    partialTopology,
    confirmTopologyAndContinue,
    diagnostics,
    reset,
  };
}
