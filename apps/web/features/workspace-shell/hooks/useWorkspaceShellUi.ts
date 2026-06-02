"use client";

import { useCallback, useMemo, useState } from "react";

export type WorkspaceShellState =
  | { kind: "genesis" }
  | { kind: "edit"; projectId: string };

export type WorkspaceDialogState =
  | { kind: "none" }
  | { kind: "new-project" }
  | { kind: "delete-confirm"; projectId: string }
  | { kind: "unsaved-editor" };

import type { ViewMode } from "@/types/view-mode";

export type { ViewMode };

export interface UseWorkspaceShellUiOptions {
  currentStepIndex: number;
  viewMode: ViewMode;
}

export interface UseWorkspaceShellUiReturn {
  state: WorkspaceShellState;
  dialog: WorkspaceDialogState;
  viewMode: ViewMode;
  currentStepIndex: number;
  activeContextId: string | null;
  activeMappingId: string | null;
  setContextId: (id: string | null) => void;
  setMappingId: (id: string | null) => void;
  openDialog: (dialog: WorkspaceDialogState) => void;
  closeDialog: () => void;
  enterEditMode: (projectId: string) => void;
  enterGenesisMode: () => void;
}

export function useWorkspaceShellUi(
  options: UseWorkspaceShellUiOptions,
): UseWorkspaceShellUiReturn {
  const [state, setState] = useState<WorkspaceShellState>({ kind: "genesis" });
  const [dialog, setDialog] = useState<WorkspaceDialogState>({ kind: "none" });
  const [activeContextId, setActiveContextId] = useState<string | null>(null);
  const [activeMappingId, setActiveMappingId] = useState<string | null>(null);

  const enterEditMode = useCallback((projectId: string) => {
    setState({ kind: "edit", projectId });
    setDialog({ kind: "none" });
  }, []);

  const enterGenesisMode = useCallback(() => {
    setState({ kind: "genesis" });
    setDialog({ kind: "none" });
  }, []);

  const openDialog = useCallback((newDialog: WorkspaceDialogState) => {
    setDialog(newDialog);
  }, []);

  const closeDialog = useCallback(() => {
    setDialog({ kind: "none" });
  }, []);

  return useMemo(
    () => ({
      state,
      dialog,
      viewMode: options.viewMode,
      currentStepIndex: options.currentStepIndex,
      activeContextId,
      activeMappingId,
      setContextId: setActiveContextId,
      setMappingId: setActiveMappingId,
      openDialog,
      closeDialog,
      enterEditMode,
      enterGenesisMode,
    }),
    [
      state,
      dialog,
      options.viewMode,
      options.currentStepIndex,
      activeContextId,
      activeMappingId,
      setActiveContextId,
      setActiveMappingId,
      openDialog,
      closeDialog,
      enterEditMode,
      enterGenesisMode,
    ],
  );
}
