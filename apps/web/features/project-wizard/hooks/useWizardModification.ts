"use client";

import { useCallback, useState } from "react";
import type { Patch } from "@hexagen/reconciliation-engine";

export type WizardModificationStatus =
  | "idle"
  | "streaming"
  | "review"
  | "accepting"
  | "rejecting"
  | "accepted"
  | "rejected"
  | "failed";

export interface WizardModificationState {
  status: WizardModificationStatus;
  transactionId: string | null;
  patches: Patch[];
  error: string | null;
}

const STREAM_ENDPOINT = "/api/architecture/modify/stream";

export function useWizardModification() {
  const [state, setState] = useState<WizardModificationState>({
    status: "idle",
    transactionId: null,
    patches: [],
    error: null,
  });

  const generateModification = useCallback(async (intent: string) => {
    if (!intent.trim()) return;

    setState({
      status: "streaming",
      transactionId: null,
      patches: [],
      error: null,
    });

    try {
      const response = await fetch(STREAM_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent }),
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

            if (currentEvent === "pipeline_complete") {
              const patches = (parsed.patches ?? []) as Patch[];
              const transactionId = (parsed.transactionId as string) ?? "";
              setState({
                status: "review",
                transactionId,
                patches,
                error: null,
              });
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
      const errorMsg = error instanceof Error ? error.message : String(error);
      setState((prev) => ({
        ...prev,
        status: "failed",
        error: errorMsg,
      }));
    }
  }, []);

  const acceptModification = useCallback(async () => {
    if (!state.transactionId) {
      throw new Error("No active transaction to accept");
    }

    setState((prev) => ({ ...prev, status: "accepting" }));

    try {
      const response = await fetch("/api/architecture/modify/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionId: state.transactionId,
        }),
      });

      const data = (await response.json()) as {
        success: boolean;
        error?: string;
        lintErrors?: string[];
      };

      if (!data.success) {
        setState((prev) => ({
          ...prev,
          status: "failed",
          error: data.error ?? "Accept failed",
        }));
        throw new Error(data.error ?? "Accept failed");
      }

      setState((prev) => ({ ...prev, status: "accepted" }));
      return data;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      setState((prev) => ({
        ...prev,
        status: "failed",
        error: errorMsg,
      }));
      throw error;
    }
  }, [state.transactionId]);

  const rejectModification = useCallback(
    async (reason?: string) => {
      if (!state.transactionId) {
        throw new Error("No active transaction to reject");
      }

      setState((prev) => ({ ...prev, status: "rejecting" }));

      try {
        const response = await fetch("/api/architecture/modify/reject", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transactionId: state.transactionId,
            reason: reason ?? "User rejected the changes",
          }),
        });

        const data = (await response.json()) as {
          success: boolean;
          error?: string;
        };

        if (!data.success) {
          setState((prev) => ({
            ...prev,
            status: "failed",
            error: data.error ?? "Reject failed",
          }));
          throw new Error(data.error ?? "Reject failed");
        }

        setState((prev) => ({ ...prev, status: "rejected" }));
        return data;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        setState((prev) => ({
          ...prev,
          status: "failed",
          error: errorMsg,
        }));
        throw error;
      }
    },
    [state.transactionId],
  );

  const reset = useCallback(() => {
    setState({
      status: "idle",
      transactionId: null,
      patches: [],
      error: null,
    });
  }, []);

  return {
    ...state,
    generateModification,
    acceptModification,
    rejectModification,
    reset,
  };
}
