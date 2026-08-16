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

import { stepIndexById } from "../../project-wizard/config";
import { emptyFormValues } from "@/project-config-presets";
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
  const addOnsAnswers = useWatch({
    control: form.control,
    name: "addOnsAnswers",
  });

  // Full content hash: every field a consumer (canvas, code view, generation,
  // export, save/load) reads — including add-on answer VALUES and governance.
  // wizardData is rebuilt whenever this changes, so it never goes stale for any
  // consumer. The canvas-only "ignore answer-only changes" optimization lives in
  // useCanvasState (canvasRedrawKey), NOT here: gating the SHARED wizardData on a
  // canvas-relevant subset froze it for non-canvas consumers, shipping stale
  // add-on answers to generation/export.
  const contentHash = JSON.stringify({
    boundedContexts,
    externalContexts,
    peerMappings,
    governance,
    addOnsAnswers,
  });

  const wizardDataRef = useRef<WizardData | null>(null);
  const prevContentHashRef = useRef<string>(contentHash);

  // Rebuild wizardData only when its content actually changes (the reference
  // stays stable otherwise, so memoized consumers bail out).
  if (
    wizardDataRef.current === null ||
    contentHash !== prevContentHashRef.current
  ) {
    prevContentHashRef.current = contentHash;
    wizardDataRef.current = buildWizardData(
      boundedContexts,
      externalContexts,
      peerMappings,
      governance,
      addOnsAnswers,
    );
  }
  const wizardData = wizardDataRef.current!;

  // Returns a validation predicate by step index; closures over the
  // reactive boundedContexts slice so it updates as the user edits. The gated
  // step is resolved by id (not a hardcoded index) so step insertion/reorder
  // (e.g. the ADR-0041 Applications step) can't shift the gate onto the wrong
  // step.
  const canProceed = useMemo(() => {
    const boundedContextsStep = stepIndexById("bounded_contexts");
    return (stepIndex: number): boolean => {
      if (stepIndex !== boundedContextsStep) return true;
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
