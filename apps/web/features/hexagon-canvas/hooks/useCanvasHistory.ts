import { useCallback, useMemo, useRef } from "react";
import { useStore } from "zustand";
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
 *
 * Performance notes:
 * - Uses useStore with selectors for reactive pastStates/futureStates
 *   (re-renders only when the selected slices change)
 * - Holds the temporal store API in a ref so undo/redo/clear callbacks
 *   have stable identity (no dependency on getState() result)
 * - Return value is memoized to avoid destabilizing consumers
 */
export function useCanvasHistory() {
  // Ref to the temporal store API — stable across renders, no subscription
  const temporalStoreRef = useRef(useCanvasGraphStore.temporal);

  // Reactive subscriptions: re-renders only when the selected slices change
  const pastStates = useStore(temporalStoreRef.current, (s) => s.pastStates);
  const futureStates = useStore(
    temporalStoreRef.current,
    (s) => s.futureStates,
  );

  const undo = useCallback(() => {
    temporalStoreRef.current.getState().undo();
  }, []);

  const redo = useCallback(() => {
    temporalStoreRef.current.getState().redo();
  }, []);

  const clear = useCallback(() => {
    temporalStoreRef.current.getState().clear();
  }, []);

  const canUndo = pastStates.length > 0;
  const canRedo = futureStates.length > 0;

  return useMemo(
    () => ({
      undo,
      redo,
      clear,
      canUndo,
      canRedo,
      pastStates,
      futureStates,
    }),
    [undo, redo, clear, canUndo, canRedo, pastStates, futureStates],
  );
}

// Made with Bob
