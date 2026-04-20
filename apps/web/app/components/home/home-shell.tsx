"use client";

import { useMemo, useCallback } from "react";
import { useForm, useWatch, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { ResizableLayout } from "@/components/layout/ResizableLayout";
import { GovernancePanelWrapper } from "@/components/agent/GovernancePanelWrapper";
import { Header } from "../layout/Header";
import {
  wizardSteps,
  emptyFormValues,
} from "@/components/project-wizard/config";
import {
  projectConfigSchema,
  type ProjectConfig,
} from "@hexagen/project-configuration";
import type {
  BoundedContext,
  ExternalContext,
  PeerMapping,
} from "@hexagen/shared";

import { useHomeUIState } from "@/hooks/useHomeUiState";
import { useSavedProjects } from "@/hooks/useSavedProjects";
import { useWizardDraft } from "@/hooks/useWizardDraft";
import { useEditorWorkspace } from "@/hooks/useEditorWorkspace";
import { useActiveWorkspace } from "@/contexts/ActiveWorkspaceContext";
import { useWizardAutosave } from "@/hooks/useWizardAutosave";
import { useBeforeUnloadWarning } from "@/hooks/useBeforeUnloadWarning";

import { buildWizardData } from "../../lib/compose-wizard-data";
import { WizardOrSavedProjectsPane } from "./wizard-or-saved-projects-pane";
import { ArchitecturePreviewPane } from "./architecture-preview-pane";
import { LoadManifestDialog } from "./load-manifest-dialog";
import { ResumeDraftDialog } from "./resume-draft-dialog";
import { NewProjectConfirmDialog } from "./new-project-confirm-dialog";
import { useManifestImport } from "@/hooks/useManifestImport";
import { useProjectGenerationFlow } from "@/hooks/useProjectGenerationFlow";
import { governanceState } from "@/lib/governance-state";

export function HomeShell() {
  const totalSteps = wizardSteps.length;
  const form = useForm<ProjectConfig>({
    resolver: zodResolver(projectConfigSchema),
    defaultValues: emptyFormValues,
    mode: "all",
  });

  const watchedValues = useWatch({ control: form.control });

  const {
    state: uiState,
    dialog,
    viewMode,
    currentStepIndex,
    activeContextId,
    activeMappingId,
    setStep,
    setContextId,
    setMappingId,
    setViewMode,
    openDialog,
    closeDialog,
    enterEditMode,
    enterGenesisMode,
  } = useHomeUIState();

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
  const {
    state: editorWorkspace,
    setSessionId: setEditorSessionId,
    clearSession: clearEditorSession,
    updateFile,
    selectFile: editorSelectFile,
    markFileSaved,
  } = useEditorWorkspace();
  const { setActiveWorkspace, clearActiveWorkspace } = useActiveWorkspace();

  // P0: Wire deleted autosave feature (F1)
  const hasGenerated = uiState.kind === "edit";
  useWizardAutosave({
    currentStepIndex,
    hasGenerated,
    draftLoading,
    saveDraft,
    getFormValues: form.getValues,
  });

  // P0: Wire deleted beforeunload warning (F2)
  useBeforeUnloadWarning({
    hasDraft: draft !== null,
    hasGenerated,
  });

  const wizardData = useMemo(() => {
    const bc = (watchedValues.boundedContexts || []) as BoundedContext[];
    const ec = (watchedValues.externalContexts || []) as ExternalContext[];
    const pm = (watchedValues.peerMappings || []) as PeerMapping[];
    return buildWizardData(
      bc,
      ec,
      pm,
      watchedValues.governance as Parameters<typeof buildWizardData>[3],
    );
  }, [
    watchedValues.boundedContexts,
    watchedValues.externalContexts,
    watchedValues.peerMappings,
    watchedValues.governance,
  ]);

  const editedFilesContentMap = useMemo(() => {
    const record: Record<string, string> = {};
    for (const [k, v] of editorWorkspace.files) {
      record[k] = v.content;
    }
    return record;
  }, [editorWorkspace.files]);

  const canProceed =
    currentStepIndex === 1
      ? ((watchedValues.boundedContexts || []) as BoundedContext[]).length >
          0 &&
        ((watchedValues.boundedContexts || []) as BoundedContext[]).every(
          (c) => c.name?.trim() !== "",
        )
      : true;

  const { importManifest } = useManifestImport();
  const { isLoading: isGenerating, execute: executeGeneration } =
    useProjectGenerationFlow({
      saveProject,
      clearDraft,
      setActiveWorkspace,
      setEditorSessionId,
    });

  const handleNext = async () => {
    const isValid =
      currentStepIndex !== 1 || (await form.trigger("boundedContexts"));
    if (isValid) {
      if (currentStepIndex === 2) setMappingId("");
      const nextStep = Math.min(currentStepIndex + 1, totalSteps - 1);
      setStep(nextStep);
      saveDraft(form.getValues(), nextStep);
    }
  };

  const handleBack = () => {
    if (currentStepIndex === 2) setMappingId("");
    setStep(Math.max(currentStepIndex - 1, 0));
  };

  const handleShowSavedProjects = () => openDialog({ kind: "saved-projects" });

  const handleLoadProject = useCallback(
    async (id: string) => {
      const saved = loadProject(id);
      if (saved) {
        form.reset(saved.formState);
        enterEditMode(id);
        setStep(0);
        closeDialog();
        await clearDraft();
        setEditorSessionId(crypto.randomUUID());
        setActiveWorkspace({
          projectId: saved.id,
          name: saved.name,
          isDirty: false,
          lastModifiedAt: Date.now(),
          wizardData: saved.formState as unknown as Record<string, unknown>,
          manifestYaml: saved.manifestYaml,
        });
      }
    },
    [
      loadProject,
      form,
      enterEditMode,
      setStep,
      closeDialog,
      clearDraft,
      setEditorSessionId,
      setActiveWorkspace,
    ],
  );

  const handleGenerate = async () => {
    const formData = form.getValues();
    const outcome = await executeGeneration(formData);

    if (outcome.kind === "success") {
      governanceState.currentManifestYaml = outcome.manifestYaml;
    }
  };

  const handleManifestLoaded = useCallback(
    async (yamlContent: string) => {
      const outcome = await importManifest(yamlContent);
      if (outcome.kind === "success") {
        form.reset(outcome.formValues);
        enterEditMode("");
        closeDialog();
        setStep(0);
      }
    },
    [importManifest, form, enterEditMode, closeDialog, setStep],
  );

  const handleResumeDraft = useCallback(() => {
    if (draft) {
      form.reset(draft.formState as ProjectConfig);
      setStep(0);
      enterEditMode("");
      closeDialog();
    }
  }, [draft, form, setStep, enterEditMode, closeDialog]);

  const handleDiscardDraft = useCallback(async () => {
    await clearDraft();
    closeDialog();
  }, [clearDraft, closeDialog]);

  const buildManifestYaml = useCallback(() => {
    const formData = form.getValues();
    const bc = (formData.boundedContexts || []) as BoundedContext[];
    const ec = (formData.externalContexts || []) as ExternalContext[];
    const pm = (formData.peerMappings || []) as PeerMapping[];
    return buildWizardData(bc, ec, pm, formData.governance);
  }, [form]);

  const handleNewProjectClick = () => openDialog({ kind: "new-project" });

  const handleSaveAndNew = useCallback(() => {
    const loadedProjectId = uiState.kind === "edit" ? uiState.projectId : null;
    if (loadedProjectId) {
      const manifestYaml = buildManifestYaml();
      updateProject(
        loadedProjectId,
        form.getValues(),
        JSON.stringify(manifestYaml),
      );
    }
    form.reset(emptyFormValues);
    setStep(0);
    enterGenesisMode();
    closeDialog();
    clearEditorSession();
    clearActiveWorkspace();
  }, [
    uiState,
    buildManifestYaml,
    updateProject,
    form,
    setStep,
    enterGenesisMode,
    closeDialog,
    clearEditorSession,
    clearActiveWorkspace,
  ]);

  const handleDiscardAndNew = useCallback(() => {
    form.reset(emptyFormValues);
    setStep(0);
    enterGenesisMode();
    closeDialog();
    clearEditorSession();
    clearActiveWorkspace();
  }, [
    form,
    setStep,
    enterGenesisMode,
    closeDialog,
    clearEditorSession,
    clearActiveWorkspace,
  ]);

  const isEditing = uiState.kind === "edit";
  const showSavedProjects = dialog.kind === "saved-projects";

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden bg-background text-foreground">
      <Header
        onLoadManifest={() => openDialog({ kind: "load-manifest" })}
        isEditing={isEditing}
        onNewProject={handleNewProjectClick}
        onLoadSavedProject={(project) => {
          handleLoadProject(project.id);
        }}
      />

      <main className="flex-1 flex flex-col overflow-hidden">
        <FormProvider {...form}>
          <ResizableLayout
            left={
              <WizardOrSavedProjectsPane
                showSavedProjects={showSavedProjects}
                currentStepIndex={currentStepIndex}
                totalSteps={totalSteps}
                canProceed={canProceed}
                isGenerating={isGenerating}
                activeContextId={activeContextId ?? ""}
                activeMappingId={activeMappingId ?? ""}
                projects={projects}
                draft={draft}
                loadedProjectId={
                  uiState.kind === "edit" ? uiState.projectId : null
                }
                onContextSelect={setContextId}
                onMappingSelect={setMappingId}
                onNext={handleNext}
                onBack={handleBack}
                onShowSavedProjects={handleShowSavedProjects}
                onGenerate={handleGenerate}
                onViewModeChange={setViewMode}
                onLoadProject={handleLoadProject}
                onDeleteProject={deleteProject}
                onRenameProject={renameProject}
                onResumeDraft={handleResumeDraft}
                onDiscardDraft={handleDiscardDraft}
                onBackToWizard={() => closeDialog()}
              />
            }
            middle={
              <ArchitecturePreviewPane
                wizardData={wizardData}
                viewMode={viewMode}
                selectedFileId={editorWorkspace.selectedFileId}
                editedFiles={editedFilesContentMap}
                onViewModeChange={setViewMode}
                onFileSelect={editorSelectFile}
                onFileContentChange={updateFile}
                onFileSave={markFileSaved}
              />
            }
            right={
              <GovernancePanelWrapper
                wizardData={wizardData}
                currentStepIndex={currentStepIndex}
              />
            }
          />
        </FormProvider>
      </main>

      <LoadManifestDialog
        open={dialog.kind === "load-manifest"}
        onClose={closeDialog}
        onFileLoaded={handleManifestLoaded}
      />

      <ResumeDraftDialog
        open={dialog.kind === "resume-draft"}
        onClose={closeDialog}
        draft={draft}
        totalSteps={totalSteps}
        onResume={handleResumeDraft}
        onDiscard={handleDiscardDraft}
      />

      <NewProjectConfirmDialog
        open={dialog.kind === "new-project"}
        onClose={closeDialog}
        loadedProject={
          uiState.kind === "edit"
            ? (loadProject(uiState.projectId) ?? null)
            : null
        }
        onSaveAndNew={handleSaveAndNew}
        onDiscardAndNew={handleDiscardAndNew}
        onCancel={closeDialog}
      />
    </div>
  );
}
