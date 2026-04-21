"use client";

import { useCallback, useEffect } from "react";
import type { UseFormReturn } from "react-hook-form";
import type { ProjectConfig } from "@hexagen/project-configuration";

import { emptyFormValues } from "../../project-wizard/config";
import { buildWizardData } from "@/lib/compose-wizard-data";

import { useSavedProjects, type SavedProject } from "@/hooks/useSavedProjects";
import { useWizardDraft } from "./useWizardDraft";
import { useManifestImport } from "./useManifestImport";
import { useProjectGenerationFlow } from "./useProjectGenerationFlow";
import { useWizardAutosave } from "./useWizardAutosave";
import { useBeforeUnloadWarning } from "./useBeforeUnloadWarning";
import type { WizardDraft } from "@hexagen/shared";
import type {
  UseWorkspaceShellUiReturn,
  WorkspaceShellState,
} from "./useWorkspaceShellUi";
import type { UseEditorSessionReturn } from "./useEditorSession";

interface UseProjectLifecycleOptions {
  form: UseFormReturn<ProjectConfig>;
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
}

export interface UseProjectLifecycleReturn {
  // Reactive data
  projects: SavedProject[];
  draft: WizardDraft | null;
  isGenerating: boolean;
  loadedProject: SavedProject | null;

  // Project CRUD
  deleteProject: (id: string) => void;
  renameProject: (id: string, name: string) => void;

  // Orchestrated handlers
  handleNext: () => Promise<void>;
  handleBack: () => void;
  handleLoadProject: (id: string) => Promise<void>;
  handleGenerate: () => Promise<void>;
  handleManifestLoaded: (yamlContent: string) => Promise<void>;
  handleResumeDraft: () => void;
  handleDiscardDraft: () => Promise<void>;
  handleSaveAndNew: () => void;
  handleDiscardAndNew: () => void;
}

/**
 * Project lifecycle orchestrator. Owns the actions that span multiple
 * concerns (form + UI state + persistence + editor session). Composes
 * the primitive hooks (useSavedProjects, useWizardDraft,
 * useManifestImport, useProjectGenerationFlow) and wires the
 * cross-concern side effects (autosave, beforeunload, resume-draft).
 *
 * Inputs are the primitives this hook cannot own itself: the form
 * (tied to FormProvider), UI state (separate hook), editor actions
 * (separate hook). This makes the coupling explicit and testable.
 */
export function useProjectLifecycle(
  options: UseProjectLifecycleOptions,
): UseProjectLifecycleReturn {
  const { form, ui, uiState, editor, totalSteps } = options;

  const {
    projects,
    loadProject,
    deleteProject,
    renameProject,
    updateProject,
    saveProject,
  } = useSavedProjects();

  const {
    draft,
    saveDraft,
    clearDraft,
    loading: draftLoading,
  } = useWizardDraft();

  const { importManifest } = useManifestImport();

  const { isLoading: isGenerating, execute: executeGeneration } =
    useProjectGenerationFlow({
      saveProject,
      clearDraft,
      setActiveWorkspace: editor.setActiveWorkspace,
      setEditorSessionId: editor.setSessionId,
    });

  const hasGenerated = uiState.kind === "edit";

  // Cross-cutting side effects — all related to project persistence
  useWizardAutosave({
    currentStepIndex: ui.currentStepIndex,
    hasGenerated,
    draftLoading,
    saveDraft,
    getFormValues: form.getValues,
  });

  useBeforeUnloadWarning({
    hasDraft: draft !== null,
    hasGenerated,
  });

  // Auto-show resume dialog when a draft exists on mount.
  // Only fires when draft loading settles (intentionally narrow deps —
  // re-opening on every dialog/uiState change would be wrong UX).
  useEffect(() => {
    if (!draftLoading && draft && uiState.kind !== "edit") {
      ui.openDialog({ kind: "resume-draft", projectId: "" });
    }
  }, [draftLoading]);

  // Wizard navigation
  const handleNext = useCallback(async () => {
    const isValid =
      ui.currentStepIndex !== 1 || (await form.trigger("boundedContexts"));
    if (!isValid) return;

    if (ui.currentStepIndex === 2) ui.setMappingId("");
    const nextStep = Math.min(ui.currentStepIndex + 1, totalSteps - 1);
    ui.setStep(nextStep);
    saveDraft(form.getValues(), nextStep);
  }, [ui, form, totalSteps, saveDraft]);

  const handleBack = useCallback(() => {
    if (ui.currentStepIndex === 2) ui.setMappingId("");
    ui.setStep(Math.max(ui.currentStepIndex - 1, 0));
  }, [ui]);

  // Project load
  const handleLoadProject = useCallback(
    async (id: string) => {
      const saved = loadProject(id);
      if (!saved) return;

      form.reset(saved.formState);
      ui.enterEditMode(id);
      ui.setStep(0);
      ui.closeDialog();
      await clearDraft();
      editor.setSessionId(crypto.randomUUID());
      editor.setActiveWorkspace({
        projectId: saved.id,
        name: saved.name,
        isDirty: false,
        lastModifiedAt: Date.now(),
        wizardData: saved.formState as unknown as Record<string, unknown>,
        manifestYaml: saved.manifestYaml,
      });
    },
    [loadProject, form, ui, clearDraft, editor],
  );

  // Generation
  const handleGenerate = useCallback(async () => {
    // executeGeneration writes manifestYaml into ActiveWorkspaceContext
    // via setActiveWorkspace — governance panel reads it from there.
    await executeGeneration(form.getValues());
  }, [executeGeneration, form]);

  // Manifest import
  const handleManifestLoaded = useCallback(
    async (yamlContent: string) => {
      const outcome = await importManifest(yamlContent);
      if (outcome.kind === "success") {
        form.reset(outcome.formValues);
        ui.enterEditMode("");
        ui.closeDialog();
        ui.setStep(0);
      }
    },
    [importManifest, form, ui],
  );

  // Draft actions
  const handleResumeDraft = useCallback(() => {
    if (!draft) return;
    form.reset(draft.formState as ProjectConfig);
    ui.setStep(0);
    ui.enterEditMode("");
    ui.closeDialog();
  }, [draft, form, ui]);

  const handleDiscardDraft = useCallback(async () => {
    await clearDraft();
    ui.closeDialog();
  }, [clearDraft, ui]);

  // New-project actions
  const handleSaveAndNew = useCallback(() => {
    if (uiState.kind === "edit") {
      const formData = form.getValues();
      const wizardData = buildWizardData(
        formData.boundedContexts,
        formData.externalContexts,
        formData.peerMappings,
        formData.governance,
      );
      updateProject(uiState.projectId, formData, JSON.stringify(wizardData));
    }
    form.reset(emptyFormValues);
    ui.setStep(0);
    ui.enterGenesisMode();
    ui.closeDialog();
    editor.clearSession();
    editor.clearActiveWorkspace();
  }, [uiState, form, updateProject, ui, editor]);

  const handleDiscardAndNew = useCallback(() => {
    form.reset(emptyFormValues);
    ui.setStep(0);
    ui.enterGenesisMode();
    ui.closeDialog();
    editor.clearSession();
    editor.clearActiveWorkspace();
  }, [form, ui, editor]);

  const loadedProject =
    uiState.kind === "edit" ? (loadProject(uiState.projectId) ?? null) : null;

  return {
    projects,
    draft,
    isGenerating,
    loadedProject,
    deleteProject,
    renameProject,
    handleNext,
    handleBack,
    handleLoadProject,
    handleGenerate,
    handleManifestLoaded,
    handleResumeDraft,
    handleDiscardDraft,
    handleSaveAndNew,
    handleDiscardAndNew,
  };
}
