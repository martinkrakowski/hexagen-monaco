"use client";

import { useCanvasHistory } from "./useCanvasHistory";

interface UseCanvasHistoryControllerResult {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useCanvasHistoryController(): UseCanvasHistoryControllerResult {
  const { undo, redo, canUndo, canRedo } = useCanvasHistory();

  return {
    undo,
    redo,
    canUndo,
    canRedo,
  };
}
