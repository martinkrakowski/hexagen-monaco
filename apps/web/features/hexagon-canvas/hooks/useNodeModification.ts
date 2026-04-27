"use client";

import { useCallback, useRef, useState } from "react";
import type { HexagonNode } from "@hexagen/visualization";
import type { Patch } from "@hexagen/reconciliation-engine";

export type NodeModificationStatus =
  | "idle"
  | "detecting"
  | "streaming"
  | "review"
  | "accepting"
  | "rejecting"
  | "accepted"
  | "rejected"
  | "failed";

export interface NodeModificationState {
  status: NodeModificationStatus;
  transactionId: string | null;
  patches: Patch[];
  error: string | null;
  pendingChanges: CanvasChange[];
}

export interface CanvasChange {
  type: "add" | "remove" | "update";
  nodeId?: string;
  before?: Partial<HexagonNode>;
  after?: Partial<HexagonNode>;
  timestamp: number;
}

const STREAM_ENDPOINT = "/api/architecture/modify/stream";
const DEBOUNCE_MS = 1000;

export function useNodeModification() {
  const [state, setState] = useState<NodeModificationState>({
    status: "idle",
    transactionId: null,
    patches: [],
    error: null,
    pendingChanges: [],
  });

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const recordChange = useCallback((change: Omit<CanvasChange, "timestamp">) => {
    setState((prev) => ({
      ...prev,
      pendingChanges: [
        ...prev.pendingChanges,
        { ...change, timestamp: Date.now() },
      ],
    }));
  }, []);

  const onNodeDragStop = useCallback(
    (before: HexagonNode, after: HexagonNode) => {
      if (
        before.position.x === after.position.x &&
        before.position.y === after.position.y
      ) {
        return;
      }
      recordChange({
        type: "update",
        nodeId: after.id,
        before: { position: before.position },
        after: { position: after.position },
      });
    },
    [recordChange],
  );

  const onNodeRemove = useCallback(
    (node: HexagonNode) => {
      recordChange({
        type: "remove",
        nodeId: node.id,
        before: node,
      });
    },
    [recordChange],
  );

  const onNodeAdd = useCallback(
    (node: HexagonNode) => {
      recordChange({
        type: "add",
        nodeId: node.id,
        after: node,
      });
    },
    [recordChange],
  );

  const debouncedGenerateModification = useCallback(
    async (intent: string) => {
      if (!intent.trim()) return;

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(async () => {
        abortControllerRef.current?.abort();
        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        setState((prev) => ({
          ...prev,
          status: "streaming",
          transactionId: null,
          patches: [],
          error: null,
        }));

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

                if (currentEvent === "pipeline_complete") {
                  const patches = (parsed.patches ?? []) as Patch[];
                  const transactionId = (parsed.transactionId as string) ?? "";
                  setState({
                    status: "review",
                    transactionId,
                    patches,
                    error: null,
                    pendingChanges: [],
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
          if (error instanceof DOMException && error.name === "AbortError") {
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
      }, DEBOUNCE_MS);
    },
    [],
  );

  const submitPendingChanges = useCallback(
    (nodes: HexagonNode[]) => {
      const changes = state.pendingChanges;
      if (changes.length === 0) return;

      const intent = buildIntentFromChanges(changes, nodes);
      debouncedGenerateModification(intent);
    },
    [state.pendingChanges, debouncedGenerateModification],
  );

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
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setState({
      status: "idle",
      transactionId: null,
      patches: [],
      error: null,
      pendingChanges: [],
    });
  }, []);

  return {
    ...state,
    onNodeDragStop,
    onNodeRemove,
    onNodeAdd,
    submitPendingChanges,
    acceptModification,
    rejectModification,
    reset,
  };
}

function buildIntentFromChanges(
  changes: CanvasChange[],
  nodes: HexagonNode[],
): string {
  const parts: string[] = [];

  for (const change of changes) {
    if (change.type === "add" && change.after) {
      const label = change.after.label ?? "new node";
      parts.push(`Add bounded context "${label}"`);
    } else if (change.type === "remove" && change.nodeId) {
      const node = nodes.find((n) => n.id === change.nodeId);
      const label = node?.label ?? change.nodeId;
      parts.push(`Remove bounded context "${label}"`);
    } else if (change.type === "update" && change.nodeId && change.after) {
      const node = nodes.find((n) => n.id === change.nodeId);
      const label = node?.label ?? change.nodeId;
      if (change.after.position) {
        parts.push(`Move bounded context "${label}" to new position`);
      }
      if (change.after.label && change.after.label !== node?.label) {
        parts.push(`Rename bounded context "${label}" to "${change.after.label}"`);
      }
    }
  }

  return parts.join(". ") || "Update architecture";
}
