"use client";

import { useState, useMemo, useCallback } from "react";
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
import { Footer } from "./components/layout/Footer";
import { GraphCanvasWrapper } from "@/components/canvas/GraphCanvasWrapper";
import { CodeView } from "@/components/code-view/CodeView";
import { StepHeader } from "@/components/project-wizard/steps/StepHeader";

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
import { getLogger } from "@/lib/wire";

export default function Home() {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [activeContextId, setActiveContextId] = useState<string>("");
  const [activeMappingId, setActiveMappingId] = useState<string>("");
  const [viewMode, setViewMode] = useState<"visual" | "code">("visual");
  const [mode, setMode] = useState<"genesis" | "edit">("genesis");
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [showSavedProjects, setShowSavedProjects] = useState(false);

  const { projects, saveProject, loadProject, deleteProject, renameProject } =
    useSavedProjects();

  const form = useForm<ProjectConfig>({
    resolver: zodResolver(projectConfigSchema),
    defaultValues: emptyFormValues,
    mode: "all",
  });

  const watchedValues = useWatch({ control: form.control });

  const totalSteps = wizardSteps.length;
  const currentStepConfig = wizardSteps[currentStepIndex];

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
    () => ({
      boundedContexts,
      externalContexts,
      peerMappings,
      workspaceScope: watchedValues.governance?.workspaceName || "",
      withLlm: !!watchedValues.withLlm,
      withBlockchain: !!watchedValues.withBlockchain,
    }),
    [
      boundedContexts,
      externalContexts,
      peerMappings,
      watchedValues.governance?.workspaceName,
      watchedValues.withLlm,
      watchedValues.withBlockchain,
    ],
  );

  const handleNext = async () => {
    const isValid =
      currentStepIndex !== 1 || (await form.trigger("boundedContexts"));

    if (isValid) {
      if (currentStepIndex === 2) setActiveMappingId("");
      setCurrentStepIndex((i) => Math.min(i + 1, totalSteps - 1));
    }
  };

  const handleBack = () => {
    if (currentStepIndex === 2) setActiveMappingId("");
    setCurrentStepIndex((i) => Math.max(i - 1, 0));
  };

  const handleShowSavedProjects = () => {
    setShowSavedProjects(true);
  };

  const handleLoadProject = (id: string) => {
    const saved = loadProject(id);
    if (saved) {
      form.reset(saved.formState);
      setMode("edit");
      setCurrentStepIndex(0);
      setShowSavedProjects(false);
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
      const wizardData = {
        boundedContexts: formData.boundedContexts || [],
        externalContexts: formData.externalContexts || [],
        peerMappings: formData.peerMappings || [],
        workspaceScope: formData.governance?.workspaceName || "",
        withLlm: !!formData.withLlm,
        withBlockchain: !!formData.withBlockchain,
      };

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

      // In a real app, we might show a success notification or navigate to results
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

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden bg-background text-foreground">
      <Header onLoadManifest={() => setShowLoadDialog(true)} mode={mode} />

      <main className="flex-1 flex flex-col overflow-hidden">
        <FormProvider {...form}>
          <ResizableLayout
            left={
              <Card className="h-full border-0 rounded-none overflow-hidden flex flex-col bg-card">
                <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
                  {showSavedProjects ? (
                    <SavedProjectsList
                      projects={projects}
                      onLoad={handleLoadProject}
                      onDelete={deleteProject}
                      onRename={renameProject}
                      onBackToWizard={() => setShowSavedProjects(false)}
                    />
                  ) : (
                    <>
                      <StepHeader
                        currentStep={currentStepIndex + 1}
                        totalSteps={totalSteps}
                        title={currentStepConfig.title}
                        description={currentStepConfig.description}
                      />

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
                    </>
                  )}
                </CardContent>
              </Card>
            }
            middle={
              <Card className="h-full border-0 rounded-none overflow-hidden flex flex-col bg-card">
                <CardHeader className="border-b border-border shrink-0 flex flex-row items-center justify-between space-y-0 py-3 px-4">
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
                    <CodeView wizardData={wizardData} />
                  )}
                </CardContent>
              </Card>
            }
            right={
              <AIArchitectPanel
                onSendMessage={async (message) => {
                  getLogger().info(`Chat message: ${message}`);
                }}
              />
            }
          />
        </FormProvider>
      </main>

      <Footer />

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
    </div>
  );
}
