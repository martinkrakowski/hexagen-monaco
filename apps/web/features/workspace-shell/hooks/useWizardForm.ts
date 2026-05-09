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

function stableHash(data: unknown): string {
  const str = JSON.stringify(data);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

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

  // Content-keyed memo: re-computes only when the serialized form content
  // actually changes. useWatch returns new object identity on every
  // keystroke (e.g. typing in governance.workspaceName), but we only
  // need a new wizardData when the *content* differs — the canvas
  // and code-view consumers react to structural changes, not identity.
  const contentHash = useMemo(
    () =>
      stableHash({
        boundedContexts,
        externalContexts,
        peerMappings,
        governance,
      }),
    [boundedContexts, externalContexts, peerMappings, governance],
  );
  const wizardDataRef = useRef<WizardData>(
    buildWizardData(
      boundedContexts,
      externalContexts,
      peerMappings,
      governance,
    ),
  );
  const prevHashRef = useRef<string>(contentHash);
  if (contentHash !== prevHashRef.current) {
    prevHashRef.current = contentHash;
    wizardDataRef.current = buildWizardData(
      boundedContexts,
      externalContexts,
      peerMappings,
      governance,
    );
  }
  const wizardData = wizardDataRef.current;

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
