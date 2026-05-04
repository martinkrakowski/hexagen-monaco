"use client";

import { useCallback, useRef, useState } from "react";
import type { PipelineStepStatus } from "@hexagen/ai-pipeline";

export interface StepProgress {
  name: string;
  status: PipelineStepStatus;
  durationMs: number | null;
}

export interface StreamingState {
  steps: StepProgress[];
  error: string | null;
}

const PIPELINE_STEP_NAMES = [
  "parse-nl-intent",
  "compile-prompt",
  "llm-inference",
  "reconcile",
  "commit-patches",
] as const;

function getInitialSteps(): StepProgress[] {
  return PIPELINE_STEP_NAMES.map((name) => ({
    name,
    status: "pending" as PipelineStepStatus,
    durationMs: null,
  }));
}

interface UsePipelineStreamingOptions {
  endpoint: string;
  onStepRunning?: (stepName: string) => void;
  onStepComplete?: (
    stepName: string,
    status: PipelineStepStatus,
    durationMs: number | null,
    steps: StepProgress[],
  ) => void;
  onPipelineComplete?: (
    data: Record<string, unknown>,
    steps: StepProgress[],
  ) => void;
  onPipelineError?: (error: string) => void;
}

export function usePipelineStreaming(options: UsePipelineStreamingOptions) {
  const {
    endpoint,
    onStepRunning,
    onStepComplete,
    onPipelineComplete,
    onPipelineError,
  } = options;

  const [streamingState, setStreamingState] = useState<StreamingState>({
    steps: [],
    error: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  const startStreaming = useCallback(
    async (body: Record<string, unknown>) => {
      abortControllerRef.current?.abort();
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const initialSteps = getInitialSteps();
      setStreamingState({ steps: initialSteps, error: null });

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: abortController.signal,
        });

        if (!response.ok) {
          let errorMsg = `HTTP ${response.status}`;
          try {
            const errorBody = await response.json();
            errorMsg = (errorBody as { error?: string }).error ?? errorMsg;
          } catch {
            // Ignore JSON parse errors on error responses.
          }
          setStreamingState((prev) => ({ ...prev, error: errorMsg }));
          onPipelineError?.(errorMsg);
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          const errorMsg = "No response body";
          setStreamingState((prev) => ({ ...prev, error: errorMsg }));
          onPipelineError?.(errorMsg);
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";
        let streamDone = false;

        while (!streamDone) {
          const { done, value } = await reader.read();
          if (done) {
            streamDone = true;
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          let currentEvent = "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("event: ")) {
              currentEvent = trimmed.slice(7);
            } else if (trimmed.startsWith("data: ") && currentEvent) {
              const data = trimmed.slice(6);
              let parsed: Record<string, unknown>;
              try {
                parsed = JSON.parse(data) as Record<string, unknown>;
              } catch {
                continue;
              }

              if (currentEvent === "step_running") {
                const stepName = parsed.name as string;
                onStepRunning?.(stepName);
                setStreamingState((prev) => ({
                  ...prev,
                  steps: prev.steps.map((s) =>
                    s.name === stepName
                      ? { ...s, status: "running" as PipelineStepStatus }
                      : s,
                  ),
                }));
              } else if (currentEvent === "step_complete") {
                const stepName = parsed.name as string;
                const stepStatus = parsed.status as PipelineStepStatus;
                const durationMs = parsed.durationMs as number | null;
                setStreamingState((prev) => {
                  const updatedSteps = prev.steps.map((s) =>
                    s.name === stepName
                      ? { ...s, status: stepStatus, durationMs }
                      : {
                          ...s,
                          status:
                            s.status === "running"
                              ? ("completed" as PipelineStepStatus)
                              : s.status,
                        },
                  );
                  onStepComplete?.(
                    stepName,
                    stepStatus,
                    durationMs,
                    updatedSteps,
                  );
                  return { ...prev, steps: updatedSteps };
                });
              } else if (currentEvent === "pipeline_complete") {
                setStreamingState((prev) => {
                  onPipelineComplete?.(parsed, prev.steps);
                  return prev;
                });
              } else if (currentEvent === "pipeline_error") {
                const errorMsg = (parsed.error as string) ?? "Pipeline error";
                setStreamingState((prev) => ({
                  ...prev,
                  error: errorMsg,
                }));
                onPipelineError?.(errorMsg);
              }

              currentEvent = "";
            }
          }
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        const errorMsg = error instanceof Error ? error.message : String(error);
        setStreamingState((prev) => ({ ...prev, error: errorMsg }));
        onPipelineError?.(errorMsg);
      } finally {
        abortControllerRef.current = null;
      }
    },
    [
      endpoint,
      onStepRunning,
      onStepComplete,
      onPipelineComplete,
      onPipelineError,
    ],
  );

  const abort = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setStreamingState((prev) => ({ ...prev, error: null }));
  }, []);

  return { streamingState, startStreaming, abort };
}
