"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { logger } from "../../lib/structured-logger";
import type { ClientManifestGenerationUseCase } from "@hexagen/manifest-generation";
import type {
  ClientManifestGenerationTopologyResult,
  ClientManifestGenerationAdaptersResult,
} from "@hexagen/manifest-generation";
import type { ManifestDraftContext } from "@hexagen/agentic-interaction";
import { formatModelChip } from "@hexagen/agentic-interaction";
import { getClientManifestGenerationUseCase } from "../../app/lib/wire.client";
import type {
  StagedPhase,
  StageProgress,
} from "../../app/lib/staged-generation-types";
import {
  useStagedGenerationStream,
  type StageValidationReport,
} from "../../app/lib/useStagedGenerationStream";

/** Return type of the useStagedManifestGeneration hook */
export interface UseStagedManifestGenerationReturn {
  generateManifest: (
    description: string,
    options?: {
      platform?: string;
      deployment?: string;
      additionalContext?: string;
      preferLocal?: boolean;
      /** Org whose history this cloud run belongs to; omit for personal. */
      tenantId?: string;
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
  /**
   * Early Stage-5 manifest (Part B-lite) from the cloud pipeline's
   * NON-terminal `manifest` frame — set while the Stage-6 review is still
   * streaming, so the UI can offer "Use This Manifest" before `done`.
   * `generatedManifest` (the `done` yaml, possibly repair-adjusted)
   * supersedes it; kept set after completion so consumers can detect a
   * repair-driven difference. Always null on the local WebLLM path.
   */
  earlyManifest: string | null;
  phase: StagedPhase;
  stepDetail: string;
  stageProgress: Record<number, StageProgress>;
  verboseLog: string[];
  validationErrors: string[];
  /**
   * Stage-6 review findings from the cloud pipeline's `done` event (advisory
   * — the manifest was still produced). Null while generating, after reset,
   * on the local WebLLM path (no Stage-6 runs locally), and for older server
   * payloads that omit the optional `validation` field.
   */
  validationReport: StageValidationReport | null;
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
  const [earlyManifest, setEarlyManifest] = useState<string | null>(null);
  const [phase, setPhase] = useState<StagedPhase>("idle");
  const [stepDetail, setStepDetail] = useState("");
  const [stageProgress, setStageProgress] = useState<
    Record<number, StageProgress>
  >({});
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [validationReport, setValidationReport] =
    useState<StageValidationReport | null>(null);
  const [verboseLog, setVerboseLog] = useState<string[]>([]);
  const [contextCount, setContextCount] = useState(0);
  const [portCount, setPortCount] = useState(0);
  const [adapterCount, setAdapterCount] = useState(0);

  const abortRef = useRef<AbortController | null>(null);

  // Accumulators for the verbose log, appended incrementally per cloud chunk
  // so building the log stays O(new tokens) instead of re-joining every chunk.
  const verboseLogRef = useRef<{
    text: Record<number, string>;
    label: Record<number, string>;
    consumed: Record<number, number>;
    /** Serving-model chip per stage (e.g. "[mercury-2 / gpt-4o]") */
    model: Record<number, string>;
  }>({ text: {}, label: {}, consumed: {}, model: {} });

  // Cloud streaming hook
  const cloudStream = useStagedGenerationStream({
    endpoint: "/api/manifest/generate/stage",
    stageLabels: STAGE_LABELS,
  });

  // Mirror the cloud stream into this hook's state during generation so the UI
  // updates live (instead of only after cloudStream.generate() resolves).
  //
  // The verbose-log accumulation runs BEFORE the isGenerating guard on purpose:
  // when the final chunk and the stream's "done"/"failed" event land in the
  // same React batch, isGenerating is already false on this render, so an early
  // return would drop those last tokens from the log. Per-stage text is appended
  // incrementally (only newly-arrived chunks → O(new tokens)); the entries array
  // is rebuilt only when a chunk actually arrived (≤2 entries/stage, ≤7 stages).
  // Unlike the spec endpoint (curated status text at stage -1), the staged
  // endpoint streams raw tokens at the real stage number — hence the per-stage
  // grouping under a "Stage N" header.
  useEffect(() => {
    const vlog = verboseLogRef.current;
    let changed = false;
    for (const key of Object.keys(cloudStream.stageProgress)
      .map(Number)
      .filter((n) => n >= 0)
      .sort((a, b) => a - b)) {
      const chunks = cloudStream.stageProgress[key]?.chunks;
      if (!chunks?.length) continue;
      const seen = vlog.consumed[key] ?? 0;
      if (chunks.length <= seen) continue;
      vlog.text[key] = (vlog.text[key] ?? "") + chunks.slice(seen).join("");
      vlog.label[key] = cloudStream.stageProgress[key]?.label ?? "";
      vlog.consumed[key] = chunks.length;
      changed = true;
    }
    // Model chips arrive via stage-telemetry AFTER the stage's last chunk, so
    // the chunk-driven `changed` flag alone would never re-render the header
    // with the chip — track chip changes separately. Only stages that already
    // have log text get a header, so only those are checked.
    for (const key of Object.keys(vlog.text).map(Number)) {
      const telemetry = cloudStream.stageProgress[key]?.telemetry;
      if (!telemetry) continue;
      const chip = formatModelChip(telemetry);
      if (chip && vlog.model[key] !== chip) {
        vlog.model[key] = chip;
        changed = true;
      }
    }
    if (changed) {
      const entries: string[] = [];
      for (const key of Object.keys(vlog.text)
        .map(Number)
        .sort((a, b) => a - b)) {
        const label = vlog.label[key] ? ` — ${vlog.label[key]}` : "";
        const chip = vlog.model[key] ? ` ${vlog.model[key]}` : "";
        entries.push(`Stage ${key}${label}${chip}`);
        entries.push(vlog.text[key]);
      }
      setVerboseLog(entries);
    }

    // Early manifest (Part B-lite): mirrored OUTSIDE the isGenerating guard
    // below for the same last-batch reason as the verbose log — if the
    // `manifest` frame and the terminal frame land in one React batch,
    // isGenerating is already false on this render. Only non-null values are
    // mirrored (it is set at most once per run); clearing is owned by
    // generateManifest's reset block and reset().
    if (cloudStream.earlyManifest !== null) {
      setEarlyManifest(cloudStream.earlyManifest);
    }

    // phase / stepDetail / stageProgress only need mirroring while the stream is
    // active; once it resolves, generateManifest copies the final values from
    // the result, so guard these to avoid clobbering that final state.
    if (!cloudStream.isGenerating) return;
    setPhase(cloudStream.phase);
    if (cloudStream.stepDetail) setStepDetail(cloudStream.stepDetail);
    setStageProgress(cloudStream.stageProgress);
  }, [
    cloudStream.isGenerating,
    cloudStream.earlyManifest,
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
        tenantId?: string;
        signal?: AbortSignal;
      },
    ) => {
      setGenerationError(null);
      setGeneratedManifest(null);
      setEarlyManifest(null);
      setPhase("stage-0");
      setStepDetail("Starting staged generation...");
      setStageProgress({});
      setValidationErrors([]);
      setValidationReport(null);
      setVerboseLog([]);
      verboseLogRef.current = { text: {}, label: {}, consumed: {}, model: {} };
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

          // Success — but an empty render is a failure in disguise: callers
          // key their success branch on a non-empty manifest, so returning
          // "" with phase "complete" would strand the flow with neither a
          // continue action nor an error. Route it through the normal
          // failure channel (the catch below) instead.
          const yaml = renderResult.yaml || "";
          if (!yaml.trim()) {
            throw new Error(
              "The local model produced an empty manifest. Try again or switch to cloud generation.",
            );
          }
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
              tenantId: options?.tenantId,
            },
            controller.signal,
          );

          // Symmetric with the local path's empty-render guard above: a
          // server "done" event carrying an empty document must not look
          // like success — callers key on a non-empty manifest, so phase
          // "complete" with "" would park them with no continue action and
          // no error. Normalize it to the failure shape before the state
          // writes below.
          if (
            result.phase === "complete" &&
            !result.generatedManifest?.trim()
          ) {
            result.phase = "failed";
            result.stepDetail =
              "Generation finished without producing a manifest.";
            result.generatedManifest = null;
          }

          // Use returned values from generate() instead of stale closure
          setGeneratedManifest(result.generatedManifest);
          setContextCount(result.contextCount);
          setPortCount(result.portCount);
          setAdapterCount(result.adapterCount);
          setPhase(result.phase);
          setStepDetail(result.stepDetail);
          setStageProgress(result.stageProgress);
          setValidationErrors(result.validationErrors);
          // Stage-6 report from the done event (parity with the /spec flow —
          // the stream hook already parses it; this hook previously dropped it).
          setValidationReport(result.validationReport);
          // Surface in-stream cloud failures as hook state (the stream resolves
          // rather than throwing, so the catch below never runs for them).
          if (result.phase === "failed") {
            setGenerationError(result.stepDetail || "Generation failed");
          }

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
    setEarlyManifest(null);
    setPhase("idle");
    setStepDetail("");
    setStageProgress({});
    setValidationErrors([]);
    setValidationReport(null);
    setVerboseLog([]);
    verboseLogRef.current = { text: {}, label: {}, consumed: {}, model: {} };
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
    earlyManifest,
    phase,
    stepDetail,
    stageProgress,
    verboseLog,
    validationErrors,
    validationReport,
    contextCount,
    portCount,
    adapterCount,
    reset,
  };
}
