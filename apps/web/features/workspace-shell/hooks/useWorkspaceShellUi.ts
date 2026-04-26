"use client";

import { useCallback, useState } from "react";

export type WorkspaceShellState =
  | { kind: "genesis" }
  | { kind: "edit"; projectId: string };

export type WorkspaceDialogState =
  | { kind: "none" }
  | { kind: "new-project" }
  | { kind: "load-manifest" }
  | { kind: "resume-draft"; projectId: string }
  | { kind: "delete-confirm"; projectId: string }
  | { kind: "saved-projects" };

import type { ViewMode } from "@/types/view-mode";

export type { ViewMode };

export interface UseWorkspaceShellUiReturn {
  state: WorkspaceShellState;
  dialog: WorkspaceDialogState;
  viewMode: ViewMode;
  currentStepIndex: number;
  activeContextId: string | null;
  activeMappingId: string | null;
  setStep: (index: number) => void;
  setContextId: (id: string | null) => void;
  setMappingId: (id: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  openDialog: (dialog: WorkspaceDialogState) => void;
  closeDialog: () => void;
  enterEditMode: (projectId: string) => void;
  enterGenesisMode: () => void;
}

/**
 * Pure UI state for the project workspace shell — dialogs, view mode,
 * current wizard step, currently-selected canvas IDs. No persistence,
 * no form state, no project lifecycle — just local shell UI state.
 */
export function useWorkspaceShellUi(): UseWorkspaceShellUiReturn {
  const [state, setState] = useState<WorkspaceShellState>({ kind: "genesis" });
  const [dialog, setDialog] = useState<WorkspaceDialogState>({ kind: "none" });
  const [viewMode, setViewMode] = useState<ViewMode>("visual");
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
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

  return {
    state,
    dialog,
    viewMode,
    currentStepIndex,
    activeContextId,
    activeMappingId,
    setStep: setCurrentStepIndex,
    setContextId: setActiveContextId,
    setMappingId: setActiveMappingId,
    setViewMode,
    openDialog,
    closeDialog,
    enterEditMode,
    enterGenesisMode,
  };
}
