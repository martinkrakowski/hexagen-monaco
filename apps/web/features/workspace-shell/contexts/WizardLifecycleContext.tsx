import { createContext, useContext, useMemo } from "react";
import type { UseProjectLifecycleReturn } from "../hooks/useProjectLifecycle";
import { useWizardForm } from "../hooks/useWizardForm";
import { useProjectLifecycle } from "../hooks/useProjectLifecycle";
import { FormProvider } from "react-hook-form";
import type {
  UseWorkspaceShellUiReturn,
  WorkspaceShellState,
} from "../hooks/useWorkspaceShellUi";
import type { UseEditorSessionReturn } from "../hooks/useEditorSession";
import type { WizardData } from "@hexagen/project-configuration";

interface WizardLifecycleContextValue extends UseProjectLifecycleReturn {
  wizardData: WizardData;
  canProceed: (stepIndex: number) => boolean;
}

const WizardLifecycleContext =
  createContext<WizardLifecycleContextValue | null>(null);

export function useWizardLifecycleContext(): WizardLifecycleContextValue {
  const ctx = useContext(WizardLifecycleContext);
  if (!ctx) {
    throw new Error(
      "useWizardLifecycleContext must be used within a WizardLifecycleProvider",
    );
  }
  return ctx;
}

export interface WizardLifecycleProviderProps {
  children: React.ReactNode;
  ui: UseWorkspaceShellUiReturn;
  uiState: WorkspaceShellState;
  editor: Pick<
    UseEditorSessionReturn,
    | "setSessionId"
    | "clearSession"
    | "setActiveWorkspace"
    | "clearActiveWorkspace"
  >;
  totalSteps: number;
  onGoToStep: (index: number) => void;
}

export function WizardLifecycleProvider({
  children,
  ui,
  uiState,
  editor,
  totalSteps,
  onGoToStep,
}: WizardLifecycleProviderProps) {
  const { form, wizardData, canProceed } = useWizardForm();

  const lifecycle = useProjectLifecycle({
    form,
    ui,
    uiState,
    editor,
    totalSteps,
    onGoToStep,
  });

  const value = useMemo(
    () => ({
      ...lifecycle,
      wizardData,
      canProceed,
    }),
    [lifecycle, wizardData, canProceed],
  );

  return (
    <WizardLifecycleContext.Provider value={value}>
      <FormProvider {...form}>{children}</FormProvider>
    </WizardLifecycleContext.Provider>
  );
}
