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
import { Header } from "./components/layout/Header";
import { Footer } from "./components/layout/Footer";

import { MonacoEditorWrapper } from "@/components/monaco/MonacoEditorWrapper";
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
import { manifestToWizardData } from "@/lib/manifest-to-wizard-data";
import { wizardDataToFormValues } from "@/lib/wizard-data-to-form-values";

export default function Home() {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [activeContextId, setActiveContextId] = useState<string>("");
  const [activeMappingId, setActiveMappingId] = useState<string>("");
  const [viewMode, setViewMode] = useState<"visual" | "code">("visual");
  const [mode, setMode] = useState<"genesis" | "edit">("genesis");
  const [showLoadDialog, setShowLoadDialog] = useState(false);

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

  const initialManifest = useMemo(
    () => JSON.stringify(watchedValues, null, 2),
    [watchedValues],
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

  const handleGenerate = () => {
    setLoading(true);
    setTimeout(() => setLoading(false), 1000);
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
                <StepHeader
                  currentStep={currentStepIndex + 1}
                  totalSteps={totalSteps}
                  title={currentStepConfig.title}
                  description={currentStepConfig.description}
                />

                <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
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
                    onGenerate={handleGenerate}
                    onViewModeChange={setViewMode}
                  />
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
              <Card className="h-full border-0 rounded-none flex flex-col bg-card">
                <CardHeader className="border-b border-border shrink-0">
                  <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                    Code Editor
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0 flex-1 overflow-hidden relative">
                  <MonacoEditorWrapper
                    initialBuffer={initialManifest}
                    sessionId="wizard-session-1"
                  />
                </CardContent>
              </Card>
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
