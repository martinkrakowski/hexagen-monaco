"use client";

import { useCallback, useMemo } from "react";
import type { RenderableHexagonNode } from "@hexagen/visualization";
import { createDefaultHexagonNode } from "@hexagen/visualization";

import { useCanvasGraphStore } from "../stores/useCanvasGraphStore";

/**
 * The canvas's user-initiated graph edits (REA-004).
 *
 * Split out of `useCanvasState`, which mixed four responsibilities: the Zustand
 * subscription, the wizard→graph derivation, ELK + IndexedDB layout I/O, and
 * these mutations. The consequence the finding names is that any layout-I/O
 * tick re-rendered every mutation caller.
 *
 * Nothing here subscribes to the store. Each callback reads the current graph
 * via `useCanvasGraphStore.getState()` at invocation time, so this hook's
 * result is referentially stable for the whole session: a component that only
 * needs "add a node" no longer re-renders when a layout pass flips
 * `isLayoutCalculating`.
 */

export interface CanvasGraphMutations {
  onNodeDragStop: (node: RenderableHexagonNode) => void;
  onAddNode: () => string;
  onUpdateNode: (
    nodeId: string,
    updates: Pick<RenderableHexagonNode, "label" | "type">,
  ) => void;
}

export interface UseCanvasGraphMutationsOptions {
  /** Legacy IndexedDB position persistence, mirrored on drag stop. */
  persistNodePosition: (
    nodeId: string,
    position: { x: number; y: number },
  ) => void;
}

export function useCanvasGraphMutations({
  persistNodePosition,
}: UseCanvasGraphMutationsOptions): CanvasGraphMutations {
  const onNodeDragStop = useCallback(
    (node: RenderableHexagonNode) => {
      persistNodePosition(node.id, node.position);
      useCanvasGraphStore.getState().updateNodePosition(node.id, node.position);
    },
    [persistNodePosition],
  );

  /**
   * Add an entity node next to the root hexagon. Returns the new node's id so
   * the caller can select it — previously this hook wrote the selection itself,
   * which is why it needed the owning component's `setState`.
   */
  const onAddNode = useCallback((): string => {
    const { nodes, edges, setGraph } = useCanvasGraphStore.getState();
    const anchor = nodes.find((n) => n.id === "root-core") ?? nodes[0];
    const position = anchor
      ? { x: anchor.position.x + 220, y: anchor.position.y + 220 }
      : { x: 100, y: 100 };
    const newNode = createDefaultHexagonNode("entity", "New Node", position);

    setGraph([...nodes, newNode], edges);
    return newNode.id;
  }, []);

  const onUpdateNode = useCallback(
    (
      nodeId: string,
      updates: Pick<RenderableHexagonNode, "label" | "type">,
    ) => {
      const { nodes, edges, setGraph } = useCanvasGraphStore.getState();
      setGraph(
        nodes.map((n) => (n.id === nodeId ? { ...n, ...updates } : n)),
        edges,
      );
    },
    [],
  );

  return useMemo(
    () => ({ onNodeDragStop, onAddNode, onUpdateNode }),
    [onNodeDragStop, onAddNode, onUpdateNode],
  );
}
