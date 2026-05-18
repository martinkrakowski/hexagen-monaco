"use client";

import { useState, useCallback, useRef } from "react";
import { logger } from "../../lib/structured-logger";
import type { StagedPhase, StageProgress } from "./staged-generation-types";

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
    contextCount: number;
    portCount: number;
    adapterCount: number;
  }>;
  reset: () => void;
  cancel: () => void;
  retry: () => void;
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
        contextCount: 0,
        portCount: 0,
        adapterCount: 0,
      };

       try {
         const MAX_RECONNECT_ATTEMPTS = 3;
         const BASE_DELAY_MS = 1000;
         const READ_TIMEOUT_MS = 60000;

         let lastDataTime = Date.now();
         let timeoutCheckInterval: NodeJS.Timeout | null = null;

         const attemptReconnect = async (attempt: number): Promise<ReadableStreamDefaultReader | null> => {
           if (attempt >= MAX_RECONNECT_ATTEMPTS) {
             console.error(`[SSE] Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached`); // eslint-disable-line no-console
             return null;
           }
           
           const delay = BASE_DELAY_MS * Math.pow(2, attempt);
           // eslint-disable-next-line no-console
          console.log(`[SSE] Reconnecting in ${delay}ms (attempt ${attempt + 1}/${MAX_RECONNECT_ATTEMPTS})`);
           
           await new Promise(resolve => setTimeout(resolve, delay));
           
           try {
             const newResponse = await fetch(endpoint, { 
               method: "POST",
               headers: { "Content-Type": "application/json" },
               body: JSON.stringify(body),
               signal: abortRef.current?.signal 
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
             // eslint-disable-next-line no-console
          console.warn('[SSE] Timeout: no data received for 60s');
             reader.cancel();
           }
         }, 5000);

          // eslint-disable-next-line no-constant-condition
          try {
            while (true) {
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
                      const telemetry = event.telemetry as StageProgress["telemetry"];
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
                   logger.warn("[staged-gen] Failed to parse NDJSON line", { line });
                 }
               }
              } catch {
                // eslint-disable-next-line no-console
              console.warn('[SSE] Connection lost, attempting reconnect...');
               const newReader = await attemptReconnect(0);
               if (!newReader) {
                 throw new Error('SSE connection lost and reconnection failed');
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
    [endpoint],
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
