"use client";

import { useMemo } from "react";
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
} from "@hexagen/project-configuration";
import type { WizardData } from "@hexagen/shared";

import { emptyFormValues } from "../../features/project-wizard/config";
import { buildWizardData } from "@/lib/compose-wizard-data";

export interface UseWizardFormReturn {
  form: UseFormReturn<ProjectConfig>;
  boundedContexts: ProjectConfig["boundedContexts"];
  externalContexts: ProjectConfig["externalContexts"];
  peerMappings: ProjectConfig["peerMappings"];
  governance: ProjectConfig["governance"];
  wizardData: WizardData;
  canProceed: (stepIndex: number) => boolean;
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

  // Memo: re-computes only when a watched form slice changes
  const wizardData = useMemo(
    () =>
      buildWizardData(
        boundedContexts,
        externalContexts,
        peerMappings,
        governance,
      ),
    [boundedContexts, externalContexts, peerMappings, governance],
  );

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
  };
}
