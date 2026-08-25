"use client";

import { useCallback, useMemo, useState } from "react";
import type { PipelineStepStatus } from "@hexagen/ai-pipeline";
import type { Patch } from "@hexagen/reconciliation-engine";
import { usePipelineStreaming } from "./usePipelineStreaming";
import type { StepProgress } from "./usePipelineStreaming";

import { fetchWithCsrf } from "@/lib/csrf-fetch";
export type { StepProgress };

export type ArchitectureModificationStatus =
  | "idle"
  | "streaming"
  | "completed"
  | "failed";

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
  optimisticStatus: "idle" | "accepting" | "rejecting";
  previousResult: ArchitectureModificationResult | null;
}

const STREAM_ENDPOINT = "/api/architecture/modify/stream";

export function useArchitectureModification() {
  const [state, setState] = useState<ArchitectureModificationState>({
    status: "idle",
    steps: [],
    result: null,
    error: null,
    optimisticStatus: "idle",
    previousResult: null,
  });

  const { startStreaming, abort: abortStreaming } = usePipelineStreaming({
    endpoint: STREAM_ENDPOINT,
    onStepRunning: () => {},
    onStepComplete: () => {},
    onPipelineComplete: (data, steps) => {
      const completeData = data as unknown as PipelineCompleteData;
      setState((prev) => ({
        ...prev,
        status: "completed",
        result: {
          ...completeData,
          steps: [...steps],
        },
      }));
    },
    onPipelineError: (error) => {
      setState((prev) => ({
        ...prev,
        status: "failed",
        error,
      }));
    },
  });

  const modify = useCallback(
    async (intent: string) => {
      if (!intent.trim()) return;

      setState({
        status: "streaming",
        steps: [],
        result: null,
        error: null,
        optimisticStatus: "idle",
        previousResult: null,
      });

      await startStreaming({ intent });
    },
    [startStreaming],
  );

  const abort = useCallback(() => {
    abortStreaming();
    setState((prev) => ({ ...prev, status: "idle" }));
  }, [abortStreaming]);

  const reset = useCallback(() => {
    setState({
      status: "idle",
      steps: [],
      result: null,
      error: null,
      optimisticStatus: "idle",
      previousResult: null,
    });
  }, []);

  const acceptPatches = useCallback(async () => {
    if (!state.result?.transactionId) {
      throw new Error("No active transaction to accept");
    }

    setState((prev) => ({
      ...prev,
      optimisticStatus: "accepting",
      previousResult: prev.result,
    }));

    const optimisticResult: ArchitectureModificationResult = {
      ...state.result,
      steps: state.result.steps.map((s) => ({
        ...s,
        status: "completed" as PipelineStepStatus,
      })),
    };

    setState((prev) => ({ ...prev, result: optimisticResult }));

    try {
      const response = await fetchWithCsrf("/api/architecture/modify/accept", {
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
        setState((prev) => ({
          ...prev,
          optimisticStatus: "idle",
          result: prev.previousResult,
        }));
        throw new Error(data.error ?? "Accept failed");
      }
      setState((prev) => ({
        ...prev,
        optimisticStatus: "idle",
        previousResult: null,
      }));
      return data;
    } catch (error) {
      setState((prev) => ({
        ...prev,
        optimisticStatus: "idle",
        result: prev.previousResult,
      }));
      throw error;
    }
  }, [state.result?.transactionId, state.result]);

  const rejectPatches = useCallback(
    async (reason?: string) => {
      if (!state.result?.transactionId) {
        throw new Error("No active transaction to reject");
      }

      setState((prev) => ({
        ...prev,
        optimisticStatus: "rejecting",
        previousResult: prev.result,
      }));

      const optimisticResult: ArchitectureModificationResult = {
        ...state.result,
        steps: state.result.steps.map((s) => ({
          ...s,
          status: "completed" as PipelineStepStatus,
        })),
      };

      setState((prev) => ({ ...prev, result: optimisticResult }));

      try {
        const response = await fetchWithCsrf(
          "/api/architecture/modify/reject",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              transactionId: state.result.transactionId,
              reason: reason ?? "User rejected the changes",
            }),
          },
        );
        const data = (await response.json()) as {
          success: boolean;
          error?: string;
          transactionId?: string;
          status?: string;
          reason?: string;
        };
        if (!data.success) {
          setState((prev) => ({
            ...prev,
            optimisticStatus: "idle",
            result: prev.previousResult,
          }));
          throw new Error(data.error ?? "Reject failed");
        }
        setState((prev) => ({
          ...prev,
          optimisticStatus: "idle",
          previousResult: null,
        }));
        return data;
      } catch (error) {
        setState((prev) => ({
          ...prev,
          optimisticStatus: "idle",
          result: prev.previousResult,
        }));
        throw error;
      }
    },
    [state.result?.transactionId, state.result],
  );

  return useMemo(
    () => ({
      ...state,
      modify,
      abort,
      reset,
      acceptPatches,
      rejectPatches,
    }),
    [state, modify, abort, reset, acceptPatches, rejectPatches],
  );
}
