"use client";

import { useState, useCallback } from "react";
import { ResizableLayout } from "@/components/layout/ResizableLayout";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Header } from "./components/layout/Header";
import { Footer } from "./components/layout/Footer";
import { cn } from "@/lib/utils";
import { MonacoEditorWrapper } from "@/components/monaco/MonacoEditorWrapper";
import { GraphCanvasWrapper } from "@/components/canvas/graph-canvas-wrapper";

import {
  emptyFormValues,
  wizardSteps,
} from "@/components/project-wizard/config";
import { useForm, useWatch, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  projectConfigSchema,
  type ProjectConfig,
} from "@hexagen/project-configuration";
import type {
  WizardData,
  BoundedContext,
  ExternalContext,
} from "@hexagen/shared";
import { deriveActiveContext } from "@hexagen/shared";
import { IProjectWizardController } from "@hexagen/wizard-orchestration";
import {
  WorkspaceGovernanceStep,
  BoundedContextStep,
  BoundedContextSidebar,
  PeerContextMappingStep,
  PortConfigurationStep,
  SummaryStep,
} from "@/components/project-wizard/steps";

type Intent =
  | {
      type: "WIZARD_NEXT";
      source: "user" | "agent";
      payload: Partial<ProjectConfig>;
      metadata: { confidence: number };
    }
  | {
      type: "WIZARD_BACK";
      source: "user" | "agent";
      payload: null;
      metadata: { confidence: number };
    }
  | {
      type: "GENERATE_PROJECT";
      source: "user" | "agent";
      payload: ProjectConfig;
      metadata: { confidence: number };
    }
  | {
      type: "RESET";
      source: "user" | "agent";
      payload: null;
      metadata: { confidence: number };
    };

export default function Home() {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [activeContextId, setActiveContextId] = useState<string>("");

  const form = useForm<ProjectConfig>({
    resolver: zodResolver(projectConfigSchema),
    defaultValues: emptyFormValues,
    mode: "all",
  });

  const watchedValues = useWatch({ control: form.control });

  const boundedContexts = (watchedValues.boundedContexts ||
    []) as BoundedContext[];
  const externalContexts = (watchedValues.externalContexts ||
    []) as ExternalContext[];

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const activeContext = deriveActiveContext(boundedContexts, activeContextId);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const wizardController: IProjectWizardController = {
    navigateToStep: (stepIndex: number) => setCurrentStepIndex(stepIndex),
    setActiveContextId: (id: string) => setActiveContextId(id),
  };

  // Compute fresh each render to ensure latest data reaches canvas
  const wizardData: WizardData = {
    boundedContexts: boundedContexts,
    externalContexts: externalContexts,
    workspaceScope: watchedValues.governance?.workspaceName || "",
    withLlm: watchedValues.withLlm,
    withBlockchain: watchedValues.withBlockchain,
  };

  const currentStep = wizardSteps[currentStepIndex];
  const isFirstStep = currentStepIndex === 0;

  const canProceed =
    currentStepIndex === 1
      ? boundedContexts.length > 0 &&
        boundedContexts.every((c) => c.name?.trim())
      : true;

  const dispatchIntent = useCallback(
    async (intent: Intent) => {
      switch (intent.type) {
        case "WIZARD_NEXT": {
          const isValid =
            currentStepIndex !== 1 || (await form.trigger("boundedContexts"));
          if (isValid) {
            setCurrentStepIndex((i) => Math.min(i + 1, wizardSteps.length - 1));
          }
          break;
        }
        case "WIZARD_BACK":
          setCurrentStepIndex((i) => Math.max(i - 1, 0));
          break;
        case "GENERATE_PROJECT":
          setLoading(true);
          setTimeout(() => setLoading(false), 1000);
          break;
        case "RESET":
          form.reset(emptyFormValues);
          setCurrentStepIndex(0);
          setActiveContextId("");
          break;
      }
    },
    [form, currentStepIndex],
  );

  const initialManifest = JSON.stringify(watchedValues, null, 2);
  const sessionId = "wizard-session-1";

  const handleNext = () => {
    dispatchIntent({
      type: "WIZARD_NEXT",
      source: "user",
      payload: form.getValues(),
      metadata: { confidence: 1 },
    });
  };

  const handleBack = () => {
    dispatchIntent({
      type: "WIZARD_BACK",
      source: "user",
      payload: null,
      metadata: { confidence: 1 },
    });
  };

  const handleGenerate = () => {
    dispatchIntent({
      type: "GENERATE_PROJECT",
      source: "user",
      payload: form.getValues(),
      metadata: { confidence: 1 },
    });
  };

  // Render the appropriate step component
  const renderStep = () => {
    switch (currentStepIndex) {
      case 0:
        return (
          <WorkspaceGovernanceStep
            onNext={handleNext}
            onBack={handleBack}
            canProceed={isFirstStep}
          />
        );
      case 1:
        return (
          <BoundedContextStep
            onNext={handleNext}
            onBack={handleBack}
            canProceed={canProceed}
          />
        );
      case 2:
        return (
          <PeerContextMappingStep
            onNext={handleNext}
            onBack={handleBack}
            canProceed={canProceed}
          />
        );
      case 3:
        return (
          <PortConfigurationStep
            onNext={handleNext}
            onBack={handleBack}
            canProceed={canProceed}
          />
        );
      case 4:
        return (
          <SummaryStep
            onBack={handleBack}
            onGenerate={handleGenerate}
            canProceed={canProceed}
            isGenerating={loading}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden">
      <Header />
      <main className="flex-1 flex flex-col overflow-hidden">
        <ResizableLayout
          left={
            <Card className="h-full border-0 rounded-none overflow-hidden flex flex-col">
              <CardHeader>
                <CardTitle>HexaGen Project Wizard</CardTitle>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
                {currentStepIndex === 1 ? (
                  <FormProvider {...form}>
                    <div className="flex flex-col h-full">
                      <div className="shrink-0 border-b border-slate-200">
                        <BoundedContextSidebar
                          activeContextId={activeContextId}
                          onContextSelect={setActiveContextId}
                        />
                      </div>
                      <div className="flex-1 overflow-hidden">
                        <BoundedContextStep
                          onNext={handleNext}
                          onBack={handleBack}
                          canProceed={canProceed}
                          activeContextId={activeContextId}
                        />
                      </div>
                    </div>
                  </FormProvider>
                ) : (
                  <div className="flex-1 flex flex-col p-8 overflow-y-auto">
                    <div className="mb-4 text-[10px] font-mono bg-black text-green-400 p-2 rounded">
                      STEP: {currentStepIndex + 1} ({currentStep.id})
                    </div>

                    <div className="flex gap-2 mb-8">
                      {wizardSteps.map((_, i) => (
                        <div
                          key={i}
                          className={cn(
                            "w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm",
                            i === currentStepIndex
                              ? "bg-primary text-primary-foreground border-primary"
                              : i < currentStepIndex
                                ? "bg-primary/20 text-primary border-primary"
                                : "bg-muted text-muted-foreground border-muted",
                          )}
                        >
                          {i + 1}
                        </div>
                      ))}
                    </div>

                    <h2 className="text-2xl font-semibold mb-2">
                      {currentStep.title}
                    </h2>
                    <p className="text-muted-foreground mb-8 text-sm">
                      {currentStep.description}
                    </p>

                    <div className="flex-1">
                      <FormProvider {...form}>{renderStep()}</FormProvider>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          }
          middle={
            <Card className="h-full border-0 rounded-none overflow-hidden flex flex-col">
              <CardHeader className="border-b border-border">
                <CardTitle className="text-sm text-muted-foreground">
                  Architecture Preview
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 p-0 overflow-hidden">
                <GraphCanvasWrapper projectId="demo" wizardData={wizardData} />
              </CardContent>
            </Card>
          }
          right={
            <Card className="h-full border-0 rounded-none flex flex-col">
              <CardHeader className="shrink-0">
                <CardTitle className="text-sm text-muted-foreground">
                  Code Editor
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 flex-1 overflow-hidden">
                <MonacoEditorWrapper
                  initialBuffer={initialManifest}
                  sessionId={sessionId}
                />
              </CardContent>
            </Card>
          }
        />
      </main>
      <Footer />
    </div>
  );
}
