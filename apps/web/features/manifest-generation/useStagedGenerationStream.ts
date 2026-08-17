"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { logger } from "../../lib/structured-logger";
import { persistStageTelemetry } from "../../app/lib/persist-run-telemetry";
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

/**
 * Boundary guard for the per-stage telemetry payload — same untrusted-NDJSON
 * rationale as the report/summary guards above (proxy/corrupt stream/server-
 * contract drift). The telemetry UI formats the numeric fields
 * (`toLocaleString()`, arithmetic), so a malformed payload must be rejected
 * here rather than throwing during render. Validates every required field so
 * the narrow to `StageTelemetry` is sound; optional model names are tolerated.
 */
function isStageTelemetry(
  value: unknown,
): value is NonNullable<StageProgress["telemetry"]> {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.stage === "number" &&
    typeof t.label === "string" &&
    typeof t.durationMs === "number" &&
    typeof t.usedLLM === "boolean" &&
    typeof t.retryCount === "number" &&
    typeof t.inputTokensEstimate === "number" &&
    typeof t.outputTokensActual === "number" &&
    typeof t.servedFromCache === "boolean" &&
    typeof t.summary === "string"
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
  /** Early Stage-5 manifest (Part B-lite): set when the NON-terminal
   * `manifest` frame arrives, while the Stage-6 review is still streaming.
   * The terminal `done` frame's yaml (possibly Stage-7-repaired) supersedes
   * it as `generatedManifest`; this stays set so consumers can detect a
   * repair-driven difference between the two. */
  earlyManifest: string | null;
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
    earlyManifest: string | null;
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
  const [earlyManifest, setEarlyManifest] = useState<string | null>(null);
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

  // Abort any in-flight stream when the consumer unmounts (review fix).
  // Early-enable makes this a routine path — the user can navigate away on
  // the `manifest` frame while Stage 6/7 still stream; without the abort the
  // read loop and its inactivity watchdog keep running until the server
  // closes the stream.
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const generate = useCallback(
    async (body: Record<string, unknown>, signal?: AbortSignal) => {
      lastBodyRef.current = body;
      setGeneratedManifest(null);
      setEarlyManifest(null);
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
        earlyManifest: null as string | null,
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

      // Stages normally get a StageProgress entry on `stage-start`; Stage 7
      // (repair) emits telemetry with no stage-start, so ensure a well-formed
      // entry exists before merging telemetry/duration/chunks onto it (else the
      // spread of `undefined` yields an entry missing stage/label/chunks).
      const ensureStageEntry = (
        stage: number,
        labelHint?: string,
      ): StageProgress =>
        result.stageProgress[stage] ?? {
          stage,
          label: labelHint ?? stageLabels[stage] ?? `Stage ${stage}`,
          chunks: [],
        };

      // Single writer for terminal frames: the in-loop NDJSON parser AND the
      // residual-buffer flush both route through here, so the two paths cannot
      // drift as the `done` payload grows — path drift was exactly how residual
      // error frames got silently dropped in the first place. Returns true when
      // the event was a terminal (`done`/`error`) frame.
      const applyTerminalFrame = (event: Record<string, unknown>): boolean => {
        const type = event.type as string;
        if (type === "done") {
          result.generatedManifest = event.yaml as string;
          result.contextCount = event.contextCount as number;
          result.portCount = event.portCount as number;
          result.adapterCount = event.adapterCount as number;
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
          result.phase = "complete";
          result.stepDetail = "Manifest generation complete";
          setPhase(result.phase);
          setStepDetail(result.stepDetail);
          setIsGenerating(false);
          return true;
        }
        if (type === "error") {
          result.phase = "failed";
          result.stepDetail = event.message as string;
          setGenerationError(event.message as string);
          setPhase(result.phase);
          // Keep the stepDetail STATE in step with result.stepDetail — without
          // this the UI keeps showing the prior stage label after a failure
          // (ManifestGeneratingStep renders stepDetail regardless of phase).
          setStepDetail(result.stepDetail);
          setIsGenerating(false);
          return true;
        }
        return false;
      };

      try {
        const MAX_RECONNECT_ATTEMPTS = 3;
        const BASE_DELAY_MS = 1000;
        const READ_TIMEOUT_MS = 300000; // 5 minutes to accommodate rate-limited endpoints (e.g., NVIDIA free tier at 40tps)

        let lastDataTime = Date.now();
        let timeoutCheckInterval: ReturnType<typeof setInterval> | null = null;
        // Terminal-frame accounting: a well-formed NDJSON stream always ends
        // with a `done` or `error` frame. When the reader ends without one
        // (server crash, proxy close, watchdog cancel), the loop used to break
        // silently — phase stayed parked on the last stage and generate()
        // resolved as if nothing happened. Set by the in-loop done/error
        // branches AND the residual-buffer flush below.
        let sawTerminalFrame = false;
        // Set by the inactivity watchdog just before it cancels the reader
        // (cancel() resolves the pending read() with done: true — no throw, so
        // no reconnect attempt) so the missing-terminal-frame handler can
        // surface a distinct timeout message instead of a generic one.
        let timedOut = false;

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
            timedOut = true;
            reader.cancel();
          }
        }, 5000);

        try {
          readLoop: for (;;) {
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
                      [stage]: { ...ensureStageEntry(stage), durationMs },
                    };
                    setStageProgress(result.stageProgress);
                  } else if (type === "stage-telemetry") {
                    if (isStageTelemetry(event.telemetry)) {
                      const telemetry = event.telemetry;
                      persistStageTelemetry(telemetry, {
                        projectId:
                          typeof body.projectId === "string"
                            ? body.projectId
                            : undefined,
                      });
                      // Key by the guard-validated `telemetry.stage` rather than
                      // an unchecked `event.stage as number` cast: the server
                      // emits `event.stage = telemetry.stage` (pipeline-selection
                      // `onStageTelemetry`), so it's the same value and is already
                      // proven to be a number by isStageTelemetry.
                      const stage = telemetry.stage;
                      result.stageProgress = {
                        ...result.stageProgress,
                        [stage]: {
                          ...ensureStageEntry(stage, telemetry.label),
                          telemetry,
                        },
                      };
                      setStageProgress(result.stageProgress);
                    } else if (event.telemetry != null) {
                      logger.warn(
                        "[staged-gen] Ignoring malformed stage-telemetry payload",
                      );
                    }
                  } else if (type === "chunk") {
                    const stage = event.stage as number;
                    const data = event.data as string;
                    const entry = ensureStageEntry(stage);
                    result.stageProgress = {
                      ...result.stageProgress,
                      [stage]: {
                        ...entry,
                        chunks: [...entry.chunks, data],
                      },
                    };
                    setStageProgress(result.stageProgress);
                  } else if (type === "validation-error") {
                    const errors = event.errors as string[];
                    result.validationErrors = errors;
                    setValidationErrors(errors);
                  } else if (type === "manifest") {
                    // Early Stage-5 manifest (Part B-lite) — NON-terminal by
                    // protocol: the loop keeps reading (Stage-6 chunks and the
                    // terminal `done`/`error` still follow), so this branch
                    // must NOT touch phase/isGenerating or the terminal-frame
                    // accounting. Deliberately not handled in the residual-
                    // buffer flush: a `manifest` frame stranded there means
                    // the stream died before any terminal frame, i.e. the run
                    // failed and early-enable is moot.
                    if (
                      typeof event.yaml === "string" &&
                      event.yaml.length > 0
                    ) {
                      result.earlyManifest = event.yaml;
                      setEarlyManifest(result.earlyManifest);
                    }
                  } else if (applyTerminalFrame(event)) {
                    sawTerminalFrame = true;
                    // A done/error frame is terminal by protocol — stop reading
                    // instead of waiting for the server to close the stream. A
                    // connection held open after `done` would otherwise park
                    // generate() (and useStagedSpecGeneration's run lock) on
                    // the pending read() until the inactivity watchdog fires.
                    void reader.cancel().catch(() => {
                      logger.warn(
                        "[SSE] Failed to cancel stream after terminal frame",
                      );
                    });
                    break readLoop;
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

        // Residual-buffer flush: a terminal frame that arrived WITHOUT a
        // trailing newline never went through the in-loop branches — route it
        // through the same applyTerminalFrame writer (residual error frames
        // were previously dropped entirely, downgrading a reported failure
        // into a silent hang).
        if (buffer.trim()) {
          try {
            const event = JSON.parse(buffer) as Record<string, unknown>;
            if (applyTerminalFrame(event)) {
              sawTerminalFrame = true;
            }
          } catch {
            // Unparseable residual buffer: not a terminal frame — the
            // missing-terminal-frame handler below reports the truncation.
          }
        }

        // Reader ended without a `done`/`error` frame and without the user
        // aborting: the stream died mid-generation (server crash, proxy close,
        // or the inactivity watchdog above cancelled the reader). Surface a
        // failed state with retry-oriented copy instead of resolving as if the
        // run were still in flight. The copy must NOT contain the substring
        // "No cloud LLM API keys configured" — ImportProjectSpecPage
        // special-cases that exact text to reroute to the description flow.
        if (!sawTerminalFrame && !controller.signal.aborted) {
          const message = timedOut
            ? `Generation timed out: no data received for ${READ_TIMEOUT_MS / 1000} seconds. Please retry.`
            : "The generation stream ended unexpectedly before finishing. Please retry.";
          logger.error(`[staged-gen] ${message}`);
          result.phase = "failed";
          result.stepDetail = message;
          setGenerationError(message);
          setPhase(result.phase);
          // Same stale-label hazard as applyTerminalFrame's error arm: sync
          // the stepDetail state with result.stepDetail on this failure path.
          setStepDetail(result.stepDetail);
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
        // Same stale-label hazard as applyTerminalFrame's error arm.
        setStepDetail(result.stepDetail);
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
    setEarlyManifest(null);
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
    earlyManifest,
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
