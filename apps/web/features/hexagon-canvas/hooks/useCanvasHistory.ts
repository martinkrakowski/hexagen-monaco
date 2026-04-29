import { useCallback } from "react";
import { useCanvasGraphStore } from "../stores/useCanvasGraphStore";

/**
 * Hook for undo/redo operations on the canvas graph.
 *
 * The temporal middleware automatically tracks state changes and provides
 * undo/redo capabilities. This hook provides a clean interface to those operations.
 *
 * Key features:
 * - Only records snapshots on specific actions (not every pixel during drag)
 * - Maintains a history of up to 50 states
 * - Excludes ephemeral UI state from history
 */
export function useCanvasHistory() {
  const temporalState = useCanvasGraphStore.temporal.getState();

  const undo = useCallback(() => {
    temporalState.undo();
  }, [temporalState]);

  const redo = useCallback(() => {
    temporalState.redo();
  }, [temporalState]);

  const clear = useCallback(() => {
    temporalState.clear();
  }, [temporalState]);

  const canUndo = temporalState.pastStates.length > 0;
  const canRedo = temporalState.futureStates.length > 0;

  return {
    undo,
    redo,
    clear,
    canUndo,
    canRedo,
    pastStates: temporalState.pastStates,
    futureStates: temporalState.futureStates,
  };
}

// Made with Bob
