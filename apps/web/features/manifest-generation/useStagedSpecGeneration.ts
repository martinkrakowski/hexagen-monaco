"use client";

import { useState, useEffect, useRef } from "react";
import type {
  StagedPhase,
  StageProgress,
} from "../../app/lib/staged-generation-types";
import {
  useStagedGenerationStream,
  type StageValidationReport,
  type StageRepairSummary,
} from "../../app/lib/useStagedGenerationStream";
import { countManifestEntities } from "@hexagen/agentic-interaction";
import { createLocalProgressCallbacks } from "./mapLocalLLMProgressCallbacks";
import {
  getClientSpecGenerationUseCase,
  isLocalLLMReady,
  hasServerLLMAccessKey,
} from "../../app/lib/wire.client";

export interface SpecGenerationOptions {
  platform?: string;
  deployment?: string;
  additionalContext?: string;
  executionStrategy?: "auto" | "local" | "cloud";
  /** Org whose history this cloud run belongs to; omit for personal. */
  tenantId?: string;
  signal?: AbortSignal;
}

export function resolveExecutionStrategy(
  strategy: "auto" | "local" | "cloud",
  hasLocalLLM: boolean,
  hasCloudKeys: boolean,
): "local" | "cloud" | "none" {
  if (strategy === "local") return hasLocalLLM ? "local" : "none";
  if (strategy === "cloud") return hasCloudKeys ? "cloud" : "none";
  // auto: prefer cloud. The server pipeline completes a multi-context spec in
  // seconds; a loaded WebLLM model used to win here and could burn minutes
  // before failing stage 3/4 structured output and silently falling back.
  // Local remains the auto choice only when no cloud key is configured;
  // explicitly choosing local is the "local" strategy (PR-3 adds the UI).
  if (hasCloudKeys) return "cloud";
  if (hasLocalLLM) return "local";
  return "none";
}

/** Result shape shared by generateFromSpec and retry (undefined = run skipped). */
export type SpecGenerationResult =
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
  | undefined;

export interface UseStagedSpecGenerationReturn {
  generateFromSpec: (
    config: string,
    options?: SpecGenerationOptions,
  ) => Promise<SpecGenerationResult>;
  /**
   * Re-runs the last generateFromSpec invocation (same spec, same options).
   * Resolves undefined when no prior run exists or a run is already in
   * flight. This is the hook-level surface for the stream's retry():
   * delegating to the raw stream retry would bypass this hook's engine
   * resolution, the local-path fallback, and the completion state writes in
   * executeCloudGeneration (the stream-mirroring effect only runs while the
   * stream reports isGenerating), so retry re-enters generateFromSpec instead.
   */
  retry: () => Promise<SpecGenerationResult>;
  isGenerating: boolean;
  generationError: string | null;
  generatedManifest: string | null;
  /**
   * Early Stage-5 manifest (Part B-lite) from the cloud pipeline's
   * NON-terminal `manifest` frame — set while the Stage-6 review (and any
   * Stage-7 repair) is still streaming, so the UI can offer the manifest
   * before `done`. `generatedManifest` (the `done` yaml) supersedes it; kept
   * set after completion so consumers can detect a repair-driven difference.
   * Always null on the local path.
   */
  earlyManifest: string | null;
  phase: StagedPhase;
  stepDetail: string;
  stageProgress: Record<number, StageProgress>;
  verboseLog: string[];
  validationErrors: string[];
  validationReport: StageValidationReport | null;
  repairSummary: StageRepairSummary | null;
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

export function useStagedSpecGeneration(): UseStagedSpecGenerationReturn {
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
  const [verboseLog, setVerboseLog] = useState<string[]>([]);
  const [contextCount, setContextCount] = useState(0);
  const [portCount, setPortCount] = useState(0);
  const [adapterCount, setAdapterCount] = useState(0);
  // Owned here (not passed through from the cloud stream) so the local path can
  // set it from its own result and neither path inherits a stale prior report.
  const [validationReport, setValidationReport] =
    useState<StageValidationReport | null>(null);
  const [repairSummary, setRepairSummary] = useState<StageRepairSummary | null>(
    null,
  );

  const abortRef = useRef(false);
  const generatingLockRef = useRef(false);
  // Last ATTEMPTED generateFromSpec invocation (recorded once the lock is
  // taken, so failed runs stay replayable — that is retry()'s whole purpose),
  // remembered for retry(). The caller's AbortSignal is deliberately dropped:
  // replaying an already-aborted signal would abort the retry instantly (and a
  // one-shot "abort" listener has already been consumed).
  const lastRunRef = useRef<{
    config: string;
    options?: SpecGenerationOptions;
  } | null>(null);
  // Engine-selection banner lines (which engine is generating, fallback
  // notices). Kept in a ref because the cloud-stream mirror effect below
  // replaces verboseLog wholesale with the stream's chunk list — these lines
  // must survive that replacement.
  const engineLogRef = useRef<string[]>([]);
  const logEngineLine = (line: string) => {
    engineLogRef.current = [...engineLogRef.current, line];
    setVerboseLog((prev) => [...prev, line]);
  };
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

  // While the cloud stream is active, mirror its phase / stepDetail /
  // stageProgress / verboseLog into this hook's state so the UI updates
  // live instead of waiting for stream.generate() to resolve. The stream
  // sends chunk events with stage = -1 (status text not tied to a stage);
  // we treat those as the verbose log.
  //
  // The verbose log is updated BEFORE the isGenerating guard: when the final
  // status chunk and the stream's done/failed event land in the same React
  // batch, isGenerating is already false on this render, so an early return
  // would drop those last lines from the log.
  useEffect(() => {
    const { [-1]: chunkStage, ...numberedStages } = stream.stageProgress;
    if (chunkStage?.chunks?.length) {
      setVerboseLog([...engineLogRef.current, ...chunkStage.chunks]);
    }

    // Early manifest (Part B-lite): mirrored OUTSIDE the isGenerating guard
    // for the same last-batch reason as the verbose log above. Only non-null
    // values are mirrored (set at most once per run); clearing is owned by
    // generateFromSpec's reset block and reset().
    if (stream.earlyManifest !== null) {
      setEarlyManifest(stream.earlyManifest);
    }

    if (!stream.isGenerating) return;
    setPhase(stream.phase);
    if (stream.stepDetail) setStepDetail(stream.stepDetail);
    setStageProgress(numberedStages);
  }, [
    stream.isGenerating,
    stream.earlyManifest,
    stream.phase,
    stream.stepDetail,
    stream.stageProgress,
  ]);

  const reset = () => {
    stream.reset();
    generatingLockRef.current = false;
    engineLogRef.current = [];
    setIsGenerating(false);
    setGenerationError(null);
    setGeneratedManifest(null);
    setEarlyManifest(null);
    setPhase("idle");
    setStepDetail("");
    setStageProgress({});
    setValidationErrors([]);
    setVerboseLog([]);
    setValidationReport(null);
    setRepairSummary(null);
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
    lastRunRef.current = {
      config,
      options: options ? { ...options, signal: undefined } : undefined,
    };

    setGenerationError(null);
    setGeneratedManifest(null);
    setEarlyManifest(null);
    setPhase("stage-0");
    setStepDetail("Starting config generation...");
    setStageProgress({});
    setValidationErrors([]);
    setValidationReport(null);
    setRepairSummary(null);
    engineLogRef.current = [];
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
          tenantId: options?.tenantId,
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
      setValidationReport(result.validationReport);
      setRepairSummary(result.repairSummary);
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

    if (resolved === "cloud") {
      logEngineLine("Engine: cloud generation");
    } else if (resolved === "local") {
      logEngineLine("Engine: local generation (WebLLM model in this browser)");
    }

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

          const result = await useCase.execute(
            config,
            createLocalProgressCallbacks(
              {
                setPhase,
                setStepDetail,
                setStageProgress,
                setGenerationError,
                setVerboseLog,
              },
              { stageLabels: STAGE_LABELS, isCancelled },
            ),
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
            // Adapters live at `layers.infrastructure.adapters`, not at the
            // context root. This hook mirrored the server route's root read, so
            // the local-LLM path reported `adapterCount: 0` for every manifest
            // it generated. `countManifestEntities` is the shared counter the
            // server pipelines use — same numbers on both execution strategies.
            const adpCount = countManifestEntities(parsed).adapterCount;

            setGeneratedManifest(yaml);
            setContextCount(ctxCount);
            setPortCount(ptCount);
            setAdapterCount(adpCount);
            setPhase("complete");
            setStepDetail("Manifest generation complete");
            setValidationReport(result.validation ?? null);
            setRepairSummary(result.repair ?? null);

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
            logEngineLine(
              "Local generation did not produce a manifest — retrying via cloud",
            );
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
            logEngineLine("Local generation failed — retrying via cloud");
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

      // Provide helpful guidance for rate limit errors
      let displayMessage = message;
      if (
        message.toLowerCase().includes("rate") &&
        message.toLowerCase().includes("limit")
      ) {
        displayMessage = `${message}. Your LLM endpoint is rate-limited. Processing may take longer than usual. Consider upgrading to a higher-tier endpoint or reducing the complexity of your project specification.`;
      }

      setGenerationError(displayMessage);
      setStepDetail(displayMessage);
      setPhase("failed");
      return {
        phase: "failed" as StagedPhase,
        generationError: displayMessage,
        generatedManifest: null,
        stepDetail: displayMessage,
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

  // See the interface doc: retry re-enters generateFromSpec (not the raw
  // stream retry) so engine resolution, local fallback, and completion state
  // writes all run again. The lock inside generateFromSpec makes a retry
  // during an in-flight run a no-op (resolves undefined).
  const retry = async (): Promise<SpecGenerationResult> => {
    const last = lastRunRef.current;
    if (!last) return undefined;
    return generateFromSpec(last.config, last.options);
  };

  return {
    generateFromSpec,
    retry,
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
    repairSummary,
    contextCount,
    portCount,
    adapterCount,
    reset,
  };
}
