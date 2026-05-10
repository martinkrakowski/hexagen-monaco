"use client";

import { useMemo, useRef } from "react";
import {
  useForm,
  useWatch,
  type UseFormReturn,
  type DefaultValues,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  projectConfigSchema,
  type ProjectConfig,
  type WizardData,
} from "@hexagen/project-configuration";

import { emptyFormValues } from "../../project-wizard/config";
import { buildWizardData } from "@hexagen/wizard-orchestration";

export interface UseWizardFormReturn {
  form: UseFormReturn<ProjectConfig>;
  boundedContexts: ProjectConfig["boundedContexts"];
  externalContexts: ProjectConfig["externalContexts"];
  peerMappings: ProjectConfig["peerMappings"];
  governance: ProjectConfig["governance"];
  wizardData: WizardData;
  canProceed: (stepIndex: number) => boolean;
  contentHash: string;
}

/**
 * Owns the wizard's form state and derived reactive data.
 *
 * Does NOT own navigation (step index, next/back) — that's UI state.
 * Navigation handlers live in useProjectLifecycle which composes
 * this hook's `form` with UI actions and draft persistence.
 */
export function useWizardForm(): UseWizardFormReturn {
  const form = useForm<ProjectConfig>({
    resolver: zodResolver(projectConfigSchema),
    defaultValues: emptyFormValues as DefaultValues<ProjectConfig>,
    mode: "all",
  });

  // Named useWatch selectors return field-typed values (not DeepPartial)
  const boundedContexts = useWatch({
    control: form.control,
    name: "boundedContexts",
  });
  const externalContexts = useWatch({
    control: form.control,
    name: "externalContexts",
  });
  const peerMappings = useWatch({
    control: form.control,
    name: "peerMappings",
  });
  const governance = useWatch({ control: form.control, name: "governance" });

  // Canvas-relevant hash: only rebuild wizardData when bounded contexts,
  // external contexts, or peer mappings change. Governance field changes
  // (like workspaceName) do NOT trigger wizardData rebuild →
  // ArchitecturePreviewPane receives stable reference → React.memo bails out.
  const canvasHash = JSON.stringify({
    boundedContexts,
    externalContexts,
    peerMappings,
  });

  // Full content hash for global lifecycle needs (saving/loading)
  const contentHash = JSON.stringify({
    boundedContexts,
    externalContexts,
    peerMappings,
    governance,
  });

  const wizardDataRef = useRef<WizardData | null>(null);
  const prevCanvasHashRef = useRef<string>(canvasHash);

  // ONLY rebuild wizardData if canvas-relevant fields mutated
  if (wizardDataRef.current === null || canvasHash !== prevCanvasHashRef.current) {
    prevCanvasHashRef.current = canvasHash;
    wizardDataRef.current = buildWizardData(
      boundedContexts,
      externalContexts,
      peerMappings,
      governance,
    );
  }
  const wizardData = wizardDataRef.current!;

  // Returns a validation predicate by step index; closures over the
  // reactive boundedContexts slice so it updates as the user edits.
  const canProceed = useMemo(() => {
    return (stepIndex: number): boolean => {
      if (stepIndex !== 1) return true;
      return (
        boundedContexts.length > 0 &&
        boundedContexts.every((c) => c.name?.trim() !== "")
      );
    };
  }, [boundedContexts]);

  return {
    form,
    boundedContexts,
    externalContexts,
    peerMappings,
    governance,
    wizardData,
    canProceed,
    contentHash,
  };
}
