"use client";

import { useState, useCallback, useRef } from "react";
import { logger } from "../../lib/structured-logger";
import type { StagedPhase, StageProgress } from "./staged-generation-types";

/** Stage-6 review findings on the produced manifest — advisory, not a failure. */
export interface StageValidationReport {
  errors: string[];
  warnings: string[];
  passed: boolean;
}

/**
 * Runtime guard for the Stage-6 report at the NDJSON boundary. `event.validation`
 * is untrusted input (proxy/corrupt stream/server-contract drift), yet the UI
 * dereferences `.errors`/`.warnings` as arrays — so a malformed payload must be
 * rejected here rather than thrown during render. A bare `as` cast cannot do that.
 */
function isStageValidationReport(
  value: unknown,
): value is StageValidationReport {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    Array.isArray(r.errors) &&
    r.errors.every((e) => typeof e === "string") &&
    Array.isArray(r.warnings) &&
    r.warnings.every((w) => typeof w === "string") &&
    typeof r.passed === "boolean"
  );
}

/** Stage-7 verify-and-repair outcome — advisory context for the findings panel. */
export interface StageRepairSummary {
  attempted: boolean;
  applied: boolean;
  errorsBefore: number;
  errorsAfter: number;
  warningsBefore: number;
  warningsAfter: number;
}

/** Boundary guard for the Stage-7 summary, same rationale as the report guard. */
function isStageRepairSummary(value: unknown): value is StageRepairSummary {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.attempted === "boolean" &&
    typeof r.applied === "boolean" &&
    typeof r.errorsBefore === "number" &&
    typeof r.errorsAfter === "number" &&
    typeof r.warningsBefore === "number" &&
    typeof r.warningsAfter === "number"
  );
}

export interface StagedGenerationStreamOptions {
  endpoint: string;
  stageLabels: Record<number, string>;
}

export interface StagedGenerationStreamReturn {
  isGenerating: boolean;
  generationError: string | null;
  generatedManifest: string | null;
  phase: StagedPhase;
  stepDetail: string;
  stageProgress: Record<number, StageProgress>;
  validationErrors: string[];
  validationReport: StageValidationReport | null;
  repairSummary: StageRepairSummary | null;
  contextCount: number;
  portCount: number;
  adapterCount: number;
  generate: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<{
    generatedManifest: string | null;
    phase: StagedPhase;
    stepDetail: string;
    stageProgress: Record<number, StageProgress>;
    validationErrors: string[];
    validationReport: StageValidationReport | null;
    repairSummary: StageRepairSummary | null;
    contextCount: number;
    portCount: number;
    adapterCount: number;
  }>;
  reset: () => void;
  cancel: () => void;
  retry: () => Promise<void>;
}

function stageToPhase(stage: number): StagedPhase {
  if (stage >= 0 && stage <= 6) return `stage-${stage}` as StagedPhase;
  return "idle";
}

export function useStagedGenerationStream(
  options: StagedGenerationStreamOptions,
): StagedGenerationStreamReturn {
  const { endpoint, stageLabels } = options;

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
  const [validationReport, setValidationReport] =
    useState<StageValidationReport | null>(null);
  const [repairSummary, setRepairSummary] = useState<StageRepairSummary | null>(
    null,
  );
  const [contextCount, setContextCount] = useState(0);
  const [portCount, setPortCount] = useState(0);
  const [adapterCount, setAdapterCount] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const lastBodyRef = useRef<Record<string, unknown> | null>(null);

  const generate = useCallback(
    async (body: Record<string, unknown>, signal?: AbortSignal) => {
      lastBodyRef.current = body;
      setGeneratedManifest(null);
      setPhase("stage-0");
      setStepDetail("Starting generation...");
      setStageProgress({});
      setValidationErrors([]);
      setValidationReport(null);
      setRepairSummary(null);
      setContextCount(0);
      setPortCount(0);
      setAdapterCount(0);
      setIsGenerating(true);

      const controller = new AbortController();
      abortRef.current = controller;

      if (signal) {
        if (signal.aborted) {
          controller.abort();
        } else {
          signal.addEventListener("abort", () => controller.abort(), {
            once: true,
          });
        }
      }

      // Result object to collect final state
      const result = {
        generatedManifest: null as string | null,
        phase: "idle" as StagedPhase,
        stepDetail: "",
        stageProgress: {} as Record<number, StageProgress>,
        validationErrors: [] as string[],
        validationReport: null as StageValidationReport | null,
        repairSummary: null as StageRepairSummary | null,
        contextCount: 0,
        portCount: 0,
        adapterCount: 0,
      };

      try {
        const MAX_RECONNECT_ATTEMPTS = 3;
        const BASE_DELAY_MS = 1000;
        const READ_TIMEOUT_MS = 300000; // 5 minutes to accommodate rate-limited endpoints (e.g., NVIDIA free tier at 40tps)

        let lastDataTime = Date.now();
        let timeoutCheckInterval: ReturnType<typeof setInterval> | null = null;

        const attemptReconnect = async (
          attempt: number,
        ): Promise<ReadableStreamDefaultReader | null> => {
          if (attempt >= MAX_RECONNECT_ATTEMPTS) {
            logger.error(
              `[SSE] Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached`,
            );
            return null;
          }

          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          logger.info(
            `[SSE] Reconnecting in ${delay}ms (attempt ${attempt + 1}/${MAX_RECONNECT_ATTEMPTS})`,
          );

          await new Promise((resolve) => setTimeout(resolve, delay));

          try {
            const newResponse = await fetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
              signal: abortRef.current?.signal,
            });
            if (!newResponse.ok || !newResponse.body) return null;
            return newResponse.body.getReader();
          } catch {
            return attemptReconnect(attempt + 1);
          }
        };

        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const text = await response.text();
          throw new Error(text || `HTTP ${response.status}`);
        }

        let reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        timeoutCheckInterval = setInterval(() => {
          if (Date.now() - lastDataTime > READ_TIMEOUT_MS) {
            logger.warn(
              `[SSE] Timeout: no data received for ${READ_TIMEOUT_MS / 1000}s`,
            );
            reader.cancel();
          }
        }, 5000);

        try {
          for (;;) {
            try {
              const { done, value } = await reader.read();
              if (done) break;

              lastDataTime = Date.now();
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() || "";

              for (const line of lines) {
                if (!line.trim()) continue;
                try {
                  const event = JSON.parse(line) as Record<string, unknown>;
                  const type = event.type as string;

                  if (type === "stage-start") {
                    const stage = event.stage as number;
                    const label =
                      (event.label as string) ||
                      stageLabels[stage] ||
                      `Stage ${stage}`;
                    result.phase = stageToPhase(stage);
                    result.stepDetail = `${label}...`;
                    result.stageProgress = {
                      ...result.stageProgress,
                      [stage]: { stage, label, chunks: [] },
                    };
                    setPhase(result.phase);
                    setStepDetail(result.stepDetail);
                    setStageProgress(result.stageProgress);
                  } else if (type === "stage-complete") {
                    const stage = event.stage as number;
                    const durationMs = event.durationMs as number;
                    result.stageProgress = {
                      ...result.stageProgress,
                      [stage]: { ...result.stageProgress[stage], durationMs },
                    };
                    setStageProgress(result.stageProgress);
                  } else if (type === "stage-telemetry") {
                    const stage = event.stage as number;
                    const telemetry =
                      event.telemetry as StageProgress["telemetry"];
                    result.stageProgress = {
                      ...result.stageProgress,
                      [stage]: { ...result.stageProgress[stage], telemetry },
                    };
                    setStageProgress(result.stageProgress);
                  } else if (type === "chunk") {
                    const stage = event.stage as number;
                    const data = event.data as string;
                    result.stageProgress = {
                      ...result.stageProgress,
                      [stage]: {
                        ...result.stageProgress[stage],
                        chunks: [
                          ...(result.stageProgress[stage]?.chunks || []),
                          data,
                        ],
                      },
                    };
                    setStageProgress(result.stageProgress);
                  } else if (type === "validation-error") {
                    const errors = event.errors as string[];
                    result.validationErrors = errors;
                    setValidationErrors(errors);
                  } else if (type === "done") {
                    result.generatedManifest = event.yaml as string;
                    result.contextCount = event.contextCount as number;
                    result.portCount = event.portCount as number;
                    result.adapterCount = event.adapterCount as number;
                    result.phase = "complete";
                    result.stepDetail = "Manifest generation complete";
                    setGeneratedManifest(result.generatedManifest);
                    setContextCount(result.contextCount);
                    setPortCount(result.portCount);
                    setAdapterCount(result.adapterCount);
                    if (isStageValidationReport(event.validation)) {
                      result.validationReport = event.validation;
                      setValidationReport(result.validationReport);
                    } else if (event.validation != null) {
                      logger.warn(
                        "[staged-gen] Ignoring malformed Stage-6 validation payload",
                      );
                    }
                    if (isStageRepairSummary(event.repair)) {
                      result.repairSummary = event.repair;
                      setRepairSummary(result.repairSummary);
                    }
                    setPhase(result.phase);
                    setStepDetail(result.stepDetail);
                    setIsGenerating(false);
                  } else if (type === "error") {
                    result.phase = "failed";
                    result.stepDetail = event.message as string;
                    setGenerationError(event.message as string);
                    setPhase(result.phase);
                    setIsGenerating(false);
                  }
                } catch {
                  logger.warn("[staged-gen] Failed to parse NDJSON line", {
                    line,
                  });
                }
              }
            } catch {
              logger.warn("[SSE] Connection lost, attempting reconnect...");
              const newReader = await attemptReconnect(0);
              if (!newReader) {
                throw new Error("SSE connection lost and reconnection failed");
              }
              reader = newReader;
              continue;
            }
          }
        } finally {
          if (timeoutCheckInterval) clearInterval(timeoutCheckInterval);
          reader.releaseLock();
        }

        if (buffer.trim()) {
          try {
            const event = JSON.parse(buffer) as Record<string, unknown>;
            const type = event.type as string;

            if (type === "done") {
              result.generatedManifest = event.yaml as string;
              result.contextCount = event.contextCount as number;
              result.portCount = event.portCount as number;
              result.adapterCount = event.adapterCount as number;
              if (isStageValidationReport(event.validation)) {
                result.validationReport = event.validation;
              } else if (event.validation != null) {
                logger.warn(
                  "[staged-gen] Ignoring malformed Stage-6 validation payload",
                );
              }
              if (isStageRepairSummary(event.repair)) {
                result.repairSummary = event.repair;
              }
              result.phase = "complete";
              result.stepDetail = "Manifest generation complete";
            }
          } catch {
            // Acknowledge unprocessed buffer after parse failure
          }
        }
      } catch (error) {
        if (controller.signal.aborted) {
          logger.info("[staged-gen] Generation aborted");
          result.phase = "idle";
          setPhase("idle");
          setIsGenerating(false);
          return result;
        }
        const message =
          error instanceof Error ? error.message : "Unknown error";
        logger.error(`[staged-gen] Failed: ${message}`);
        result.phase = "failed";
        result.stepDetail = message;
        setGenerationError(message);
        setPhase(result.phase);
      } finally {
        setIsGenerating(false);
        abortRef.current = null;
      }

      return result;
    },
    [endpoint, stageLabels],
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
    setValidationReport(null);
    setRepairSummary(null);
    setContextCount(0);
    setPortCount(0);
    setAdapterCount(0);
  }, []);

  return {
    isGenerating,
    generationError,
    generatedManifest,
    phase,
    stepDetail,
    stageProgress,
    validationErrors,
    validationReport,
    repairSummary,
    contextCount,
    portCount,
    adapterCount,
    generate,
    reset,
    cancel: () => abortRef.current?.abort(),
    retry: async () => {
      if (lastBodyRef.current) {
        await reset();
        await generate(lastBodyRef.current);
      }
    },
  };
}
