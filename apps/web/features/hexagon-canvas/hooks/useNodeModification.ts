"use client";

import { useCallback, useRef, useState } from "react";
import type { HexagonNode } from "@hexagen/visualization";
import type { Patch } from "@hexagen/reconciliation-engine";
import { useModificationStreaming } from "./useModificationStreaming";

import { fetchWithCsrf } from "@/lib/csrf-fetch";
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

export function useNodeModification() {
  const [state, setState] = useState<NodeModificationState>({
    status: "idle",
    transactionId: null,
    patches: [],
    error: null,
    pendingChanges: [],
  });

  // Stabilize callback references so useModificationStreaming's startStreaming
  // identity is not invalidated on every render. Without useCallback, the
  // inline object { onPipelineComplete, onPipelineError } gets a new identity
  // each render, causing startStreaming to be recreated, which then
  // destabilizes submitPendingChanges and the entire modification chain.
  const onPipelineComplete = useCallback(
    (data: { patches: unknown[]; transactionId: string }) => {
      const patches = data.patches as Patch[];
      const transactionId = data.transactionId;
      setState({
        status: "review",
        transactionId,
        patches,
        error: null,
        pendingChanges: [],
      });
    },
    [],
  );

  const onPipelineError = useCallback((error: string) => {
    setState((prev) => ({
      ...prev,
      status: "failed",
      error,
    }));
  }, []);

  const { startStreaming, abort: abortStreaming } = useModificationStreaming({
    onPipelineComplete,
    onPipelineError,
  });

  const recordChange = useCallback(
    (change: Omit<CanvasChange, "timestamp">) => {
      setState((prev) => ({
        ...prev,
        pendingChanges: [
          ...prev.pendingChanges,
          { ...change, timestamp: Date.now() },
        ],
      }));
    },
    [],
  );

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

  const pendingChangesRef = useRef(state.pendingChanges);
  pendingChangesRef.current = state.pendingChanges;

  const submitPendingChanges = useCallback(
    (nodes: HexagonNode[]) => {
      const changes = pendingChangesRef.current;
      if (changes.length === 0) return;

      const intent = buildIntentFromChanges(changes, nodes);

      setState((prev) => ({
        ...prev,
        status: "streaming",
        transactionId: null,
        patches: [],
        error: null,
      }));

      startStreaming(intent);
    },
    [startStreaming],
  );

  // Use a ref to read the latest transactionId so acceptModification has a
  // stable identity and does not need state.transactionId in its deps array.
  const transactionIdRef = useRef(state.transactionId);
  transactionIdRef.current = state.transactionId;

  const acceptModification = useCallback(async () => {
    const currentTransactionId = transactionIdRef.current;
    if (!currentTransactionId) {
      throw new Error("No active transaction to accept");
    }

    setState((prev) => ({ ...prev, status: "accepting" }));

    try {
      const response = await fetchWithCsrf("/api/architecture/modify/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionId: currentTransactionId,
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
  }, []);

  const rejectModification = useCallback(async (reason?: string) => {
    const currentTransactionId = transactionIdRef.current;
    if (!currentTransactionId) {
      throw new Error("No active transaction to reject");
    }

    setState((prev) => ({ ...prev, status: "rejecting" }));

    try {
      const response = await fetchWithCsrf("/api/architecture/modify/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionId: currentTransactionId,
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
  }, []);

  const reset = useCallback(() => {
    abortStreaming();
    setState({
      status: "idle",
      transactionId: null,
      patches: [],
      error: null,
      pendingChanges: [],
    });
  }, [abortStreaming]);

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
        parts.push(
          `Rename bounded context "${label}" to "${change.after.label}"`,
        );
      }
    }
  }

  return parts.join(". ") || "Update architecture";
}
