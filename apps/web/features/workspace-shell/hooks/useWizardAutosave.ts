import { useEffect, useRef } from "react";
import type { ProjectConfig } from "@hexagen/project-configuration";

export interface UseWizardAutosaveReturn {
  triggerSave: () => void;
}

interface UseWizardAutosaveOptions {
  currentStepIndex: number;
  hasGenerated: boolean;
  draftLoading: boolean;
  saveDraft: (formState: ProjectConfig, savedAtStep: number) => Promise<void>;
  getFormValues: () => ProjectConfig;
}

export function useWizardAutosave({
  currentStepIndex,
  hasGenerated,
  draftLoading,
  saveDraft,
  getFormValues,
}: UseWizardAutosaveOptions): UseWizardAutosaveReturn {
  const lastSavedRef = useRef<string | null>(null);
  const lastStepRef = useRef(currentStepIndex);

  useEffect(() => {
    if (draftLoading || hasGenerated) return;

    if (lastStepRef.current !== currentStepIndex) {
      lastStepRef.current = currentStepIndex;
      const values = getFormValues();
      const serialized = JSON.stringify({ step: currentStepIndex, ...values });
      if (serialized !== lastSavedRef.current) {
        lastSavedRef.current = serialized;
        saveDraft(values, currentStepIndex).catch(console.error);
      }
    }
  }, [currentStepIndex, hasGenerated, draftLoading, saveDraft, getFormValues]);

  const triggerSave = () => {
    const values = getFormValues();
    const serialized = JSON.stringify({ step: currentStepIndex, ...values });
    lastSavedRef.current = serialized;
    saveDraft(values, currentStepIndex).catch(console.error);
  };

  return { triggerSave };
}
