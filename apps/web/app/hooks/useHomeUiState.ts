import { useCallback, useState } from "react";

export type HomeUIState =
  | { kind: "genesis" }
  | { kind: "edit"; projectId: string };

export type HomeDialogState =
  | { kind: "none" }
  | { kind: "new-project" }
  | { kind: "load-manifest" }
  | { kind: "resume-draft"; projectId: string }
  | { kind: "delete-confirm"; projectId: string }
  | { kind: "saved-projects" };

export type ViewMode = "visual" | "code";

export interface UseHomeUIStateReturn {
  state: HomeUIState;
  dialog: HomeDialogState;
  viewMode: ViewMode;
  currentStepIndex: number;
  activeContextId: string | null;
  activeMappingId: string | null;
  setStep: (index: number) => void;
  setContextId: (id: string | null) => void;
  setMappingId: (id: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  openDialog: (dialog: HomeDialogState) => void;
  closeDialog: () => void;
  enterEditMode: (projectId: string) => void;
  enterGenesisMode: () => void;
}

export function useHomeUIState(): UseHomeUIStateReturn {
  const [state, setState] = useState<HomeUIState>({ kind: "genesis" });
  const [dialog, setDialog] = useState<HomeDialogState>({ kind: "none" });
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

  const openDialog = useCallback((newDialog: HomeDialogState) => {
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
