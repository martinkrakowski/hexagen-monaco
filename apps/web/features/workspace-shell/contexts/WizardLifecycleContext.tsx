import React, { createContext, useContext, useMemo } from "react";
import { FormProvider } from "react-hook-form";
import { useWizardForm } from "../hooks/useWizardForm";
import {
  useProjectLifecycle,
  type UseProjectLifecycleReturn,
} from "../hooks/useProjectLifecycle";
import type { WizardData } from "@hexagen/project-configuration";
import type {
  UseWorkspaceShellUiReturn,
  WorkspaceShellState,
} from "../hooks/useWorkspaceShellUi";
import type { UseEditorSessionReturn } from "../hooks/useEditorSession";

interface WizardLifecycleContextValue extends UseProjectLifecycleReturn {
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
  ui: UseWorkspaceShellUiReturn;
  uiState: WorkspaceShellState;
  editor: UseEditorSessionReturn;
  totalSteps: number;
  onGoToStep: (index: number) => void;
  // Render prop: receives { wizardData } for injection
  children: (injectedProps: { wizardData: WizardData }) => React.ReactNode;
}

export function WizardLifecycleProvider({
  ui,
  uiState,
  editor,
  totalSteps,
  onGoToStep,
  children,
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

  // Memoize the context value. Because contentHash was removed from
  // lifecycle hook deps in Step 10, this context identity is highly stable.
  const value = useMemo(
    () => ({
      ...lifecycle,
      canProceed,
    }),
    [lifecycle, canProceed],
  );

  return (
    <WizardLifecycleContext.Provider value={value}>
      <FormProvider {...form}>{children({ wizardData })}</FormProvider>
    </WizardLifecycleContext.Provider>
  );
}
