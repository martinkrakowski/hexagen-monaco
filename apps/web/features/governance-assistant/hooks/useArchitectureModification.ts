"use client";

import { useCallback, useRef, useState } from "react";
import type { PipelineStepStatus } from "@hexagen/ai-pipeline";
import type { Patch } from "@hexagen/reconciliation-engine";

export type ArchitectureModificationStatus =
  | "idle"
  | "streaming"
  | "completed"
  | "failed";

export interface StepProgress {
  name: string;
  status: PipelineStepStatus;
  durationMs: number | null;
}

export interface PipelineCompleteData {
  pipelineRunId: string;
  patchesApplied: number;
  lintPassed: boolean | null;
  transactionId: string;
  patches: Patch[];
}

export interface ArchitectureModificationResult {
  pipelineRunId: string;
  patchesApplied: number;
  lintPassed: boolean | null;
  transactionId: string;
  steps: StepProgress[];
  patches: Patch[];
}

interface ArchitectureModificationState {
  status: ArchitectureModificationStatus;
  steps: StepProgress[];
  result: ArchitectureModificationResult | null;
  error: string | null;
}

const PIPELINE_STEP_NAMES = [
  "parse-nl-intent",
  "compile-prompt",
  "llm-inference",
  "reconcile",
  "commit-patches",
] as const;

const STREAM_ENDPOINT = "/api/architecture/modify/stream";

function getInitialSteps(): StepProgress[] {
  return PIPELINE_STEP_NAMES.map((name) => ({
    name,
    status: "pending" as PipelineStepStatus,
    durationMs: null,
  }));
}

export function useArchitectureModification() {
  const [state, setState] = useState<ArchitectureModificationState>({
    status: "idle",
    steps: [],
    result: null,
    error: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  const modify = useCallback(async (intent: string) => {
    if (!intent.trim()) return;

    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setState({
      status: "streaming",
      steps: getInitialSteps(),
      result: null,
      error: null,
    });

    try {
      const response = await fetch(STREAM_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent }),
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
        setState((prev) => ({
          ...prev,
          status: "failed",
          error: errorMsg,
        }));
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        setState((prev) => ({
          ...prev,
          status: "failed",
          error: "No response body",
        }));
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
              setState((prev) => ({
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
              setState((prev) => ({
                ...prev,
                steps: prev.steps.map((s) =>
                  s.name === stepName
                    ? { ...s, status: stepStatus, durationMs }
                    : {
                        ...s,
                        status:
                          s.status === "running"
                            ? ("completed" as PipelineStepStatus)
                            : s.status,
                      },
                ),
              }));
            } else if (currentEvent === "pipeline_complete") {
              const completeData = parsed as unknown as PipelineCompleteData;
              setState((prev) => ({
                ...prev,
                status: "completed",
                result: {
                  ...completeData,
                  steps: [...prev.steps],
                },
              }));
            } else if (currentEvent === "pipeline_error") {
              setState((prev) => ({
                ...prev,
                status: "failed",
                error: (parsed.error as string) ?? "Pipeline error",
              }));
            }

            currentEvent = "";
          }
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setState((prev) => ({ ...prev, status: "idle" }));
        return;
      }
      const errorMsg = error instanceof Error ? error.message : String(error);
      setState((prev) => ({
        ...prev,
        status: "failed",
        error: errorMsg,
      }));
    } finally {
      abortControllerRef.current = null;
    }
  }, []);

  const abort = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setState((prev) => ({ ...prev, status: "idle" }));
  }, []);

  const reset = useCallback(() => {
    setState({
      status: "idle",
      steps: [],
      result: null,
      error: null,
    });
  }, []);

  const acceptPatches = useCallback(async () => {
    if (!state.result?.transactionId) {
      throw new Error("No active transaction to accept");
    }
    const response = await fetch("/api/architecture/modify/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transactionId: state.result.transactionId,
      }),
    });
    const data = (await response.json()) as {
      success: boolean;
      error?: string;
      transactionId?: string;
      status?: string;
      patchesApplied?: number;
      lintPassed?: boolean;
      lintErrors?: string[];
    };
    if (!data.success) {
      throw new Error(data.error ?? "Accept failed");
    }
    return data;
  }, [state.result?.transactionId]);

  const rejectPatches = useCallback(
    async (reason?: string) => {
      if (!state.result?.transactionId) {
        throw new Error("No active transaction to reject");
      }
      const response = await fetch("/api/architecture/modify/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionId: state.result.transactionId,
          reason: reason ?? "User rejected the changes",
        }),
      });
      const data = (await response.json()) as {
        success: boolean;
        error?: string;
        transactionId?: string;
        status?: string;
        reason?: string;
      };
      if (!data.success) {
        throw new Error(data.error ?? "Reject failed");
      }
      return data;
    },
    [state.result?.transactionId],
  );

  return {
    ...state,
    modify,
    abort,
    reset,
    acceptPatches,
    rejectPatches,
  };
}
