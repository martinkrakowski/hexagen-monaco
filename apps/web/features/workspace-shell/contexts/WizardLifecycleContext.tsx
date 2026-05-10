import React, { createContext, useContext, useMemo } from "react";
import { FormProvider, type UseFormReturn } from "react-hook-form";
import { useWizardForm } from "../hooks/useWizardForm";
import {
  useProjectLifecycle,
  type UseProjectLifecycleReturn,
} from "../hooks/useProjectLifecycle";
import type { ProjectConfig, WizardData } from "@hexagen/project-configuration";
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

interface WizardDataContextValue {
  wizardData: WizardData;
}

const WizardDataContext = createContext<WizardDataContextValue | null>(null);

export function useWizardData(): WizardData {
  const ctx = useContext(WizardDataContext);
  if (!ctx) {
    throw new Error(
      "useWizardData must be used within a WizardLifecycleProvider",
    );
  }
  return ctx.wizardData;
}

const WizardFormMethodsContext = createContext<UseFormReturn<ProjectConfig> | null>(
  null,
);

export function WizardStepFormProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const form = useContext(WizardFormMethodsContext);
  if (!form) {
    throw new Error(
      "WizardStepFormProvider must be used within a WizardLifecycleProvider",
    );
  }
  return <FormProvider {...form}>{children}</FormProvider>;
}

export interface WizardLifecycleProviderProps {
  ui: UseWorkspaceShellUiReturn;
  uiState: WorkspaceShellState;
  editor: UseEditorSessionReturn;
  totalSteps: number;
  onGoToStep: (index: number) => void;
  children: React.ReactNode;
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

  const lifecycleValue = useMemo(
    () => ({
      ...lifecycle,
      canProceed,
    }),
    [lifecycle, canProceed],
  );

  const dataValue = useMemo(() => ({ wizardData }), [wizardData]);

  return (
    <WizardLifecycleContext.Provider value={lifecycleValue}>
      <WizardDataContext.Provider value={dataValue}>
        <WizardFormMethodsContext.Provider value={form}>
          {children}
        </WizardFormMethodsContext.Provider>
      </WizardDataContext.Provider>
    </WizardLifecycleContext.Provider>
  );
}
