"use client";

import { useCallback, useState } from "react";

/**
 * Discriminated state for the at-most-one overlay a saved-projects
 * row can display. Replaces five flat useState pieces (renamingId +
 * renameValue + deletingId + showDiscardDraft + pendingLoadId)
 * where multiple variants could theoretically be "on" simultaneously.
 * Here, only one kind exists at a time by construction.
 */
export type SavedProjectsOverlay =
  | { kind: "none" }
  | { kind: "rename"; id: string; value: string }
  | { kind: "delete"; id: string }
  | { kind: "discard-draft" }
  | { kind: "load-with-draft"; id: string };

export interface UseSavedProjectsOverlayReturn {
  overlay: SavedProjectsOverlay;

  /** Begin rename for a project; seeds the edit buffer with current name. */
  startRename: (id: string, currentName: string) => void;
  /** Update the rename text buffer. */
  updateRenameValue: (value: string) => void;
  /** Commit the rename. */
  commitRename: () => void;
  /** Cancel a rename in progress. */
  cancelRename: () => void;

  /** Show the delete-confirm overlay for a project. */
  requestDelete: (id: string) => void;
  /** Show the discard-draft overlay. */
  requestDiscardDraft: () => void;
  /** Show the "load-will-discard-draft" overlay. */
  requestLoadWithDraft: (id: string) => void;

  /** Close whichever overlay is open. */
  close: () => void;
}

/**
 * Owns the overlay state machine for the SavedProjectsList screen.
 * Used exclusively by that screen — the hook lives in app/hooks/
 * for consistency with other per-screen state hooks (useHomeUiState,
 * useEditableMonacoState, etc.).
 */
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

  const requestDiscardDraft = useCallback(() => {
    setOverlay({ kind: "discard-draft" });
  }, []);

  const requestLoadWithDraft = useCallback((id: string) => {
    setOverlay({ kind: "load-with-draft", id });
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
    requestDiscardDraft,
    requestLoadWithDraft,
    close,
  };
}
