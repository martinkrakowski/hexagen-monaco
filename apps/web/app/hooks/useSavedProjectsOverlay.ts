"use client";

import { useCallback, useState } from "react";

export type SavedProjectsOverlay =
  | { kind: "none" }
  | { kind: "rename"; id: string; value: string }
  | { kind: "delete"; id: string };

export interface UseSavedProjectsOverlayReturn {
  overlay: SavedProjectsOverlay;
  startRename: (id: string, currentName: string) => void;
  updateRenameValue: (value: string) => void;
  commitRename: () => void;
  cancelRename: () => void;
  requestDelete: (id: string) => void;
  close: () => void;
}

export function useSavedProjectsOverlay(): UseSavedProjectsOverlayReturn {
  const [overlay, setOverlay] = useState<SavedProjectsOverlay>({
    kind: "none",
  });

  const startRename = useCallback((id: string, currentName: string) => {
    setOverlay({ kind: "rename", id, value: currentName });
  }, []);

  const updateRenameValue = useCallback((value: string) => {
    setOverlay((prev) => (prev.kind === "rename" ? { ...prev, value } : prev));
  }, []);

  const commitRename = useCallback(() => {
    setOverlay({ kind: "none" });
  }, []);

  const cancelRename = useCallback(() => {
    setOverlay({ kind: "none" });
  }, []);

  const requestDelete = useCallback((id: string) => {
    setOverlay({ kind: "delete", id });
  }, []);

  const close = useCallback(() => {
    setOverlay({ kind: "none" });
  }, []);

  return {
    overlay,
    startRename,
    updateRenameValue,
    commitRename,
    cancelRename,
    requestDelete,
    close,
  };
}
