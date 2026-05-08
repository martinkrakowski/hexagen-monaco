import { useCallback, useEffect, useRef, useState } from "react";
import type { SavedProject } from "@/hooks/useSavedProjects";
import { useSavedProjectsOverlay } from "@/hooks/useSavedProjectsOverlay";
import { useProjectSort } from "./useProjectSort";
import { useProjectSelection } from "./useProjectSelection";
import { useRelativeTime } from "./useRelativeTime";

type ToastType = "success" | "destructive";

interface ToastState {
  message: string;
  type: ToastType;
  visible: boolean;
}

const HIDDEN_TOAST: ToastState = {
  message: "",
  type: "success",
  visible: false,
};

export function useProjectTable(
  projects: SavedProject[],
  onDeleteProject: (id: string) => void,
  onRenameProject: (id: string, newName: string) => void,
) {
  const { sort, toggleSort } = useProjectSort();
  const selection = useProjectSelection();
  const { relativeTime, shortDate } = useRelativeTime();
  const overlay = useSavedProjectsOverlay();

  const [toast, setToast] = useState<ToastState>(HIDDEN_TOAST);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, type: ToastType) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type, visible: true });
    toastTimer.current = setTimeout(() => {
      setToast((prev) => ({ ...prev, visible: false }));
    }, 2500);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const handleCommitRename = useCallback(
    (id: string) => {
      if (overlay.overlay.kind === "rename" && overlay.overlay.value.trim()) {
        onRenameProject(id, overlay.overlay.value.trim());
        showToast("Project renamed", "success");
      }
      overlay.commitRename();
    },
    [overlay, onRenameProject, showToast],
  );

  const handleConfirmDelete = useCallback(
    (id: string) => {
      onDeleteProject(id);
      overlay.close();
      selection.clearSelection();
      showToast("Project deleted", "destructive");
    },
    [onDeleteProject, overlay, selection, showToast],
  );

  const handleDeleteSelected = useCallback(() => {
    for (const id of selection.selectedIds) {
      onDeleteProject(id);
    }
    selection.clearSelection();
    showToast(
      `${selection.count} project${selection.count > 1 ? "s" : ""} deleted`,
      "destructive",
    );
  }, [selection, onDeleteProject, showToast]);

  const handleStartRename = useCallback(
    (id: string) => {
      const project = projects.find((p) => p.id === id);
      if (project) overlay.startRename(id, project.name);
    },
    [projects, overlay],
  );

  return {
    sort,
    toggleSort,
    selection,
    relativeTime,
    shortDate,
    overlay,
    toast,
    handleCommitRename,
    handleConfirmDelete,
    handleDeleteSelected,
    handleStartRename,
  };
}
