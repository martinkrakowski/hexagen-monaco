"use client";

// wireDependencies is invoked as a module-side-effect here; the composition root
// registers all ports as singletons and emits the build-info log on client bootstrap.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { wireDependencies } from "./lib/wire";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useForm, useWatch, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import yaml from "js-yaml";

import { ResizableLayout } from "@/components/layout/ResizableLayout";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { ViewToggle } from "@/components/ui/ViewToggle";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/Dialog";
import { FileDropZone } from "@/components/ui/FileDropZone";
import { AIArchitectPanel } from "@/components/agent/AIArchitectPanel";

import { Header } from "./components/layout/Header";
import { GraphCanvasWrapper } from "@/components/canvas/GraphCanvasWrapper";
import { CodeView } from "@/components/code-view/CodeView";
import { governanceState } from "@/lib/governance-state";

import {
  emptyFormValues,
  wizardSteps,
} from "@/components/project-wizard/config";
import {
  projectConfigSchema,
  type ProjectConfig,
} from "@hexagen/project-configuration";
import type {
  WizardData,
  BoundedContext,
  ExternalContext,
  PeerMapping,
} from "@hexagen/shared";

import { WizardStepRouter } from "@/components/project-wizard/WizardStepRouter";
import { SavedProjectsList } from "@/components/project-wizard/SavedProjectsList";
import { manifestToWizardData } from "@/lib/manifest-to-wizard-data";
import { wizardDataToFormValues } from "@/lib/wizard-data-to-form-values";
import { wizardToManifest } from "@/lib/wizard-to-manifest";
import { useSavedProjects } from "@/hooks/use-saved-projects";
import { useWizardDraft } from "@/hooks/use-wizard-draft";
import { useEditorWorkspace } from "@/hooks/use-editor-workspace";
import { getLogger } from "@/lib/wire";

export default function Home() {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [activeContextId, setActiveContextId] = useState<string>("");
  const [activeMappingId, setActiveMappingId] = useState<string>("");
  const [viewMode, setViewMode] = useState<"visual" | "code">("visual");
  const [mode, setMode] = useState<"genesis" | "edit">("genesis");
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [showSavedProjects, setShowSavedProjects] = useState(false);

  const {
    state: editorWorkspace,
    setSessionId: setEditorSessionId,
    clearSession: clearEditorSession,
    updateFile,
    selectFile: editorSelectFile,
    markFileSaved,
  } = useEditorWorkspace();

  const editedFilesContentMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const [k, v] of editorWorkspace.files) {
      m.set(k, v.content);
    }
    return m;
  }, [editorWorkspace.files]);

  const {
    projects,
    saveProject,
    loadProject,
    deleteProject,
    renameProject,
    updateProject,
  } = useSavedProjects();

  const {
    draft,
    saveDraft,
    clearDraft,
    loading: draftLoading,
  } = useWizardDraft();
  const [showResumeDialog, setShowResumeDialog] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  // Fires resume dialog only once — on initial mount after draft loading completes.
  // Subsequent draft changes (from autosave) must never re-trigger the dialog.
  const initialDraftChecked = useRef(false);

  const form = useForm<ProjectConfig>({
    resolver: zodResolver(projectConfigSchema),
    defaultValues: emptyFormValues,
    mode: "all",
  });

  const watchedValues = useWatch({ control: form.control });

  const totalSteps = wizardSteps.length;

  const boundedContexts = (watchedValues.boundedContexts ||
    []) as BoundedContext[];
  const externalContexts = (watchedValues.externalContexts ||
    []) as ExternalContext[];
  const peerMappings = (watchedValues.peerMappings || []) as PeerMapping[];

  const canProceed =
    currentStepIndex === 1
      ? boundedContexts.length > 0 &&
        boundedContexts.every((c) => c.name?.trim() !== "")
      : true;

  const wizardData: WizardData = useMemo(
    () =>
      ({
        boundedContexts,
        externalContexts,
        peerMappings,
        governance: watchedValues.governance ?? {
          workspaceName: "@hexagen",
          workspaceTemplate: "modular-monolith",
          packageManager: "yarn",
          topologyStrictness: "flexible",
          namespacePrefix: "@hexagen",
          namingConventions: {
            contextDirectoryPattern: "packages/",
            adapterSuffix: ".adapter.ts",
          },
        },
      }) as WizardData,
    [boundedContexts, externalContexts, peerMappings, watchedValues.governance],
  );

  // Show resume dialog once — only when a draft already existed at page load.
  // Depends only on draftLoading so autosave-triggered draft changes never re-fire it.
  useEffect(() => {
    if (!draftLoading && !initialDraftChecked.current) {
      initialDraftChecked.current = true;
      if (draft && !hasGenerated) {
        setShowResumeDialog(true);
      }
    }
  }, [draftLoading, draft, hasGenerated]);

  // Autosave draft after each step completion
  useEffect(() => {
    if (currentStepIndex > 0 && !hasGenerated && !draftLoading) {
      const timeout = setTimeout(() => {
        saveDraft(form.getValues(), currentStepIndex);
      }, 500);
      return () => clearTimeout(timeout);
    }
  }, [currentStepIndex, watchedValues, hasGenerated, draftLoading, saveDraft]);

  // beforeunload warning when draft exists and not generated
  useEffect(() => {
    if (draft && !hasGenerated) {
      const handleBeforeUnload = (e: BeforeUnloadEvent) => {
        e.preventDefault();
        e.returnValue = "";
      };
      window.addEventListener("beforeunload", handleBeforeUnload);
      return () =>
        window.removeEventListener("beforeunload", handleBeforeUnload);
    }
  }, [draft, hasGenerated]);

  const handleNext = async () => {
    const isValid =
      currentStepIndex !== 1 || (await form.trigger("boundedContexts"));

    if (isValid) {
      if (currentStepIndex === 2) setActiveMappingId("");
      const nextStep = Math.min(currentStepIndex + 1, totalSteps - 1);
      setCurrentStepIndex(nextStep);
      saveDraft(form.getValues(), nextStep);
    }
  };

  const handleBack = () => {
    if (currentStepIndex === 2) setActiveMappingId("");
    setCurrentStepIndex((i) => Math.max(i - 1, 0));
  };

  const handleShowSavedProjects = () => {
    setShowSavedProjects(true);
  };

  const handleLoadProject = async (id: string) => {
    const saved = loadProject(id);
    if (saved) {
      form.reset(saved.formState);
      setMode("edit");
      setLoadedProjectId(id);
      setCurrentStepIndex(0);
      setShowSavedProjects(false);
      await clearDraft();
      setEditorSessionId(crypto.randomUUID());
    }
  };

  function formatTimestamp(): string {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  }

  const handleGenerate = async () => {
    setLoading(true);
    try {
      // Validate the form using trigger
      const isValid = await form.trigger();
      if (!isValid) {
        setLoading(false);
        return;
      }

      const formData = form.getValues();
      const wizardData: WizardData = {
        boundedContexts: formData.boundedContexts || [],
        externalContexts: formData.externalContexts || [],
        peerMappings: formData.peerMappings || [],
        governance: formData.governance,
      } as WizardData;

      const response = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ wizardData }),
      });

      if (!response.ok) {
        throw new Error(`Generation failed: ${response.statusText}`);
      }

      const result = await response.json();

      if (result.files) {
        // Handle JSON response (for code view)
        // For now, we'll just show success - in a full implementation,
        // this would update the code view with generated files
        getLogger().info(`Generated files: ${JSON.stringify(result.files)}`);
      } else if (result.success) {
        // Handle success response
        getLogger().info(
          `Project generation initiated: ${JSON.stringify(result)}`,
        );
      }

      const projectName = `${formData.governance?.workspaceName || "project"}-${formatTimestamp()}`;
      const manifestYaml = yaml.dump(
        wizardToManifest(wizardData as Parameters<typeof wizardToManifest>[0]),
      );
      saveProject(projectName, formData, manifestYaml);
      await clearDraft();
      setHasGenerated(true);

      // Initialize new editor workspace session
      setEditorSessionId(crypto.randomUUID());

      // Store manifest for governance panel and trigger refresh
      governanceState.currentManifestYaml = manifestYaml;
    } catch (error) {
      getLogger().errorWithException(error, "Generation error");
      // In a real app, we'd show an error message to the user
    } finally {
      setLoading(false);
    }
  };

  const handleManifestLoaded = useCallback(
    (yamlContent: string) => {
      try {
        const manifest = yaml.load(yamlContent) as Record<string, unknown>;
        const wizardData = manifestToWizardData(
          manifest as Parameters<typeof manifestToWizardData>[0],
        );
        const formValues = wizardDataToFormValues(wizardData);
        form.reset(formValues);
        setMode("edit");
        setShowLoadDialog(false);
        setCurrentStepIndex(0);
      } catch {
        // Error handling will be shown in the dialog
      }
    },
    [form],
  );

  const handleResumeDraft = () => {
    if (draft) {
      form.reset(draft.formState as ProjectConfig);
      setCurrentStepIndex(0);
      setMode("edit");
      setShowResumeDialog(false);
      setShowSavedProjects(false);
    }
  };

  const handleDiscardDraft = async () => {
    await clearDraft();
    setShowResumeDialog(false);
  };

  // Generates a manifestYaml snapshot from current form values (best-effort).
  // Also stores it in governanceState so the governance panel can read it.
  const buildManifestYaml = () => {
    const formData = form.getValues();
    const data: WizardData = {
      boundedContexts: formData.boundedContexts || [],
      externalContexts: formData.externalContexts || [],
      peerMappings: formData.peerMappings || [],
      governance: formData.governance,
    } as WizardData;
    const manifestYaml = yaml.dump(wizardToManifest(data));
    governanceState.currentManifestYaml = manifestYaml;
    return manifestYaml;
  };

  const handleNewProjectClick = () => {
    setShowNewProjectDialog(true);
  };

  const handleSaveAndNew = () => {
    if (loadedProjectId) {
      updateProject(loadedProjectId, form.getValues(), buildManifestYaml());
    }
    form.reset(emptyFormValues);
    setCurrentStepIndex(0);
    setMode("genesis");
    setLoadedProjectId(null);
    setHasGenerated(false);
    setShowNewProjectDialog(false);
    setShowSavedProjects(false);
    clearEditorSession();
  };

  const handleDiscardAndNew = () => {
    form.reset(emptyFormValues);
    setCurrentStepIndex(0);
    setMode("genesis");
    setLoadedProjectId(null);
    setHasGenerated(false);
    setShowNewProjectDialog(false);
    setShowSavedProjects(false);
    clearEditorSession();
  };

  const handleFileSelect = useCallback(
    (fileId: string | null) => {
      editorSelectFile(fileId);
    },
    [editorSelectFile],
  );

  const handleFileContentChange = useCallback(
    (fileId: string, content: string) => {
      updateFile(fileId, content);
    },
    [updateFile],
  );

  const handleFileSave = useCallback(
    (fileId: string) => {
      markFileSaved(fileId);
    },
    [markFileSaved],
  );

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden bg-background text-foreground">
      <Header
        onLoadManifest={() => setShowLoadDialog(true)}
        isEditing={mode === "edit"}
        onNewProject={handleNewProjectClick}
      />

      <main className="flex-1 flex flex-col overflow-hidden">
        <FormProvider {...form}>
          <ResizableLayout
            left={
              showSavedProjects ? (
                <SavedProjectsList
                  projects={projects}
                  onLoad={handleLoadProject}
                  onDelete={deleteProject}
                  onRename={renameProject}
                  onBackToWizard={() => setShowSavedProjects(false)}
                  draft={draft}
                  onResumeDraft={handleResumeDraft}
                  onDiscardDraft={handleDiscardDraft}
                  loadedProjectId={loadedProjectId}
                />
              ) : (
                <WizardStepRouter
                  currentStepIndex={currentStepIndex}
                  totalSteps={totalSteps}
                  canProceed={canProceed}
                  isGenerating={loading}
                  activeContextId={activeContextId}
                  activeMappingId={activeMappingId}
                  onContextSelect={setActiveContextId}
                  onMappingSelect={setActiveMappingId}
                  onNext={handleNext}
                  onBack={handleBack}
                  onShowSavedProjects={handleShowSavedProjects}
                  onGenerate={handleGenerate}
                  onViewModeChange={setViewMode}
                />
              )
            }
            middle={
              <Card className="h-full border-0 rounded-none overflow-hidden flex flex-col bg-card">
                <CardHeader className="border-b border-border shrink-0 flex flex-row items-center justify-between space-y-0 py-3 px-4 h-12">
                  <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                    Architecture Preview
                  </CardTitle>
                  <ViewToggle view={viewMode} onChange={setViewMode} />
                </CardHeader>
                <CardContent className="flex-1 p-0 overflow-hidden relative">
                  {viewMode === "visual" ? (
                    <GraphCanvasWrapper
                      projectId="demo"
                      wizardData={wizardData}
                    />
                  ) : (
                    <CodeView
                      wizardData={wizardData}
                      selectedFileId={editorWorkspace.selectedFileId}
                      editedFiles={editedFilesContentMap}
                      onFileSelect={handleFileSelect}
                      onFileContentChange={handleFileContentChange}
                      onFileSave={handleFileSave}
                    />
                  )}
                </CardContent>
              </Card>
            }
            right={<AIArchitectPanel />}
          />
        </FormProvider>
      </main>

      <Dialog open={showLoadDialog} onClose={() => setShowLoadDialog(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Load Manifest</DialogTitle>
            <DialogDescription>
              Drop your existing{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">
                manifest.yaml
              </code>{" "}
              to populate the wizard.
            </DialogDescription>
          </DialogHeader>
          <FileDropZone onFileLoaded={handleManifestLoaded} />
        </DialogContent>
      </Dialog>

      <Dialog
        open={showResumeDialog}
        onClose={() => setShowResumeDialog(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resume Your Project?</DialogTitle>
            <DialogDescription>
              {draft &&
                (draft.formState as ProjectConfig).governance
                  ?.workspaceName && (
                  <span className="block font-medium text-foreground mb-1">
                    {
                      (draft.formState as ProjectConfig).governance
                        ?.workspaceName
                    }
                  </span>
                )}
              You have an unsaved project last edited{" "}
              {draft
                ? new Intl.DateTimeFormat("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  }).format(new Date(draft.updatedAt))
                : "recently"}
              . It was last saved on{" "}
              <span className="font-medium text-foreground">
                Step {(draft?.savedAtStep ?? 0) + 1} of {totalSteps}
                {" — "}
                {wizardSteps[draft?.savedAtStep ?? 0]?.title ?? ""}
              </span>
              .
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 mt-4">
            <button
              type="button"
              onClick={handleResumeDraft}
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm font-medium"
            >
              Resume — Step {(draft?.savedAtStep ?? 0) + 1} of {totalSteps}
            </button>
            <button
              type="button"
              onClick={handleDiscardDraft}
              className="flex-1 px-4 py-2 border border-input bg-background rounded-md hover:bg-muted text-sm"
            >
              Discard
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Clicking &quot;Discard&quot; will permanently delete your unsaved
            progress.
          </p>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showNewProjectDialog}
        onClose={() => setShowNewProjectDialog(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start a New Project?</DialogTitle>
            <DialogDescription>
              {loadedProjectId &&
                (() => {
                  const p = loadProject(loadedProjectId);
                  return p ? (
                    <span className="block font-medium text-foreground mb-1">
                      {p.formState.governance?.workspaceName || p.name}
                    </span>
                  ) : null;
                })()}
              You are currently editing a project. Would you like to save your
              changes before starting a new one, or discard them?
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 mt-4">
            <button
              type="button"
              onClick={handleSaveAndNew}
              className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm font-medium"
            >
              Save Changes &amp; Start New
            </button>
            <button
              type="button"
              onClick={handleDiscardAndNew}
              className="w-full px-4 py-2 border border-destructive text-destructive rounded-md hover:bg-destructive/10 text-sm"
            >
              Discard Changes &amp; Start New
            </button>
            <button
              type="button"
              onClick={() => setShowNewProjectDialog(false)}
              className="w-full px-4 py-2 border border-input bg-background rounded-md hover:bg-muted text-sm"
            >
              Cancel
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
