"use client";

import { useState, useCallback, useEffect } from "react";
import { ResizableLayout } from "@/components/layout/ResizableLayout";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Header } from "./components/layout/Header";
import { Footer } from "./components/layout/Footer";
import { cn } from "@/lib/utils";
import { MonacoEditorWrapper } from "@/components/monaco/MonacoEditorWrapper";
import { GraphCanvasWrapper } from "@/components/canvas/graph-canvas-wrapper";

import {
  emptyFormValues,
  wizardSteps,
  projectAddons,
  relationshipTypeOptions,
  apiFrameworkOptions,
  uiFrameworkOptions,
  persistenceAdapterOptions,
  messagingAdapterOptions,
} from "@/components/project-wizard/config";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  projectConfigSchema,
  type ProjectConfig,
  type BoundedContextInput,
  type ExternalContextInput,
} from "@hexagen/project-configuration";
import type {
  WizardData,
  BoundedContext,
  ContextUpdateCallback,
} from "@hexagen/shared";
import { deriveActiveContext } from "@hexagen/shared";
import { IProjectWizardController } from "@hexagen/wizard-orchestration";
import { ContextSelector } from "@/components/project-wizard/context-selector";

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
    []) as ExternalContextInput[];

  const activeContext = deriveActiveContext(boundedContexts, activeContextId);

  useEffect(() => {
    if (!activeContextId && boundedContexts.length > 0) {
      setActiveContextId(boundedContexts[0].id);
    }
  }, [boundedContexts, activeContextId]);

  const wizardController: IProjectWizardController = {
    navigateToStep: (stepIndex: number) => setCurrentStepIndex(stepIndex),
    setActiveContextId: (id: string) => setActiveContextId(id),
  };

  const handleUpdateContext: ContextUpdateCallback = (
    contextId: string,
    updates: Partial<BoundedContext>,
  ) => {
    const updated = boundedContexts.map((ctx) =>
      ctx.id === contextId ? { ...ctx, ...updates } : ctx,
    );
    form.setValue("boundedContexts", updated as BoundedContextInput[], {
      shouldDirty: true,
    });
  };

  // Compute fresh each render to ensure latest data reaches canvas
  const wizardData: WizardData = {
    boundedContexts: boundedContexts as WizardData["boundedContexts"],
    externalContexts: externalContexts as WizardData["externalContexts"],
    workspaceScope: watchedValues.workspaceScope,
    withLlm: watchedValues.withLlm,
    withBlockchain: watchedValues.withBlockchain,
  };

  const currentStep = wizardSteps[currentStepIndex];
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === wizardSteps.length - 1;

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
              <CardContent className="flex-1 flex flex-col p-8 overflow-y-auto">
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

                <div className="space-y-8 flex-1">
                  {/* Step 1: Project Type */}
                  {currentStepIndex === 0 && (
                    <div className="space-y-6">
                      <div>
                        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-3">
                          Project Type Selection
                        </label>
                        {projectAddons.map((addon) => (
                          <div
                            key={addon.id}
                            className="flex items-start gap-3 mb-4"
                          >
                            <input
                              type="checkbox"
                              checked={!!watchedValues[addon.id]}
                              onChange={(e) =>
                                form.setValue(addon.id, e.target.checked, {
                                  shouldValidate: true,
                                  shouldDirty: true,
                                })
                              }
                              className="mt-1.5 h-4 w-4 accent-primary"
                            />
                            <label className="font-medium cursor-pointer text-sm">
                              {addon.title}
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Step 2: Workspace + Bounded Contexts Registry */}
                  {currentStepIndex === 1 && (
                    <div className="space-y-6">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          Workspace Scope
                        </label>
                        <input
                          {...form.register("workspaceScope")}
                          className="w-full px-4 py-2 border rounded-md"
                          placeholder="@hexagen"
                        />
                      </div>

                      <div className="border-t pt-6">
                        <div className="flex items-center justify-between mb-4">
                          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                            Bounded Contexts
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const newId = crypto.randomUUID();
                              const newContexts = [
                                ...boundedContexts,
                                { id: newId, name: "" } as BoundedContext,
                              ];
                              form.setValue(
                                "boundedContexts",
                                newContexts as BoundedContextInput[],
                                { shouldDirty: true },
                              );
                              setActiveContextId(newId);
                            }}
                            className="text-xs px-2 py-1 bg-secondary rounded"
                          >
                            + Add Context
                          </button>
                        </div>
                        {boundedContexts.map((ctx) => (
                          <div key={ctx.id} className="flex gap-2 mb-2">
                            <input
                              value={ctx.name || ""}
                              onChange={(e) => {
                                handleUpdateContext(ctx.id, {
                                  name: e.target.value,
                                });
                              }}
                              className="flex-1 px-2 py-1 text-sm border rounded"
                              placeholder="context name"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                if (boundedContexts.length <= 1) return;
                                const updated = boundedContexts.filter(
                                  (c) => c.id !== ctx.id,
                                );
                                form.setValue(
                                  "boundedContexts",
                                  updated as BoundedContextInput[],
                                  { shouldDirty: true },
                                );
                                if (activeContextId === ctx.id) {
                                  setActiveContextId(updated[0]?.id || "");
                                }
                              }}
                              className="text-muted-foreground hover:text-destructive"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                        {boundedContexts.length === 0 && (
                          <p className="text-xs text-muted-foreground">
                            Add at least one bounded context.
                          </p>
                        )}
                      </div>

                      <div className="border-t pt-6">
                        <div className="flex items-center justify-between mb-4">
                          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                            Peer Bounded Contexts
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const current = externalContexts;
                              form.setValue(
                                "externalContexts",
                                [
                                  ...current,
                                  {
                                    id: crypto.randomUUID(),
                                    name: "",
                                    relationshipType: "U",
                                  },
                                ],
                                { shouldDirty: true },
                              );
                            }}
                            className="text-xs px-2 py-1 bg-secondary rounded"
                          >
                            + Add Peer
                          </button>
                        </div>
                        {externalContexts.map((ctx, idx) => (
                          <div key={ctx.id} className="flex gap-2 mb-2">
                            <input
                              value={ctx.name || ""}
                              onChange={(e) => {
                                const updated = [...externalContexts];
                                updated[idx] = {
                                  ...updated[idx],
                                  name: e.target.value,
                                };
                                form.setValue("externalContexts", updated, {
                                  shouldDirty: true,
                                });
                              }}
                              className="flex-1 px-2 py-1 text-sm border rounded"
                              placeholder="peer context name"
                            />
                            <select
                              value={ctx.relationshipType || "U"}
                              onChange={(e) => {
                                const updated = [...externalContexts];
                                updated[idx] = {
                                  ...updated[idx],
                                  relationshipType: e.target
                                    .value as ExternalContextInput["relationshipType"],
                                };
                                form.setValue("externalContexts", updated, {
                                  shouldDirty: true,
                                });
                              }}
                              className="text-xs border rounded"
                            >
                              {relationshipTypeOptions.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => {
                                const updated = externalContexts.filter(
                                  (_, i) => i !== idx,
                                );
                                form.setValue("externalContexts", updated, {
                                  shouldDirty: true,
                                });
                              }}
                              className="text-muted-foreground hover:text-destructive"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                        {externalContexts.length === 0 && (
                          <p className="text-xs text-muted-foreground">
                            No peer contexts defined.
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Step 3: Configure Context */}
                  {currentStepIndex === 2 && boundedContexts.length > 0 && (
                    <div className="space-y-6">
                      {boundedContexts.length > 1 && (
                        <ContextSelector
                          contexts={boundedContexts}
                          activeId={activeContextId}
                          controller={wizardController}
                        />
                      )}

                      {activeContext && (
                        <>
                          <div className="border-t pt-4">
                            <h3 className="text-sm font-medium mb-3">
                              Infrastructure
                            </h3>
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <label className="text-xs text-muted-foreground block mb-1">
                                  API Framework
                                </label>
                                <select
                                  value={activeContext.apiFramework || ""}
                                  onChange={(e) => {
                                    handleUpdateContext(activeContextId, {
                                      apiFramework: e.target
                                        .value as BoundedContextInput["apiFramework"],
                                    });
                                  }}
                                  className="w-full px-3 py-2 border rounded-md text-sm"
                                >
                                  <option value="">Select...</option>
                                  {apiFrameworkOptions.map((o) => (
                                    <option key={o} value={o}>
                                      {o}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="text-xs text-muted-foreground block mb-1">
                                  UI Framework
                                </label>
                                <select
                                  value={activeContext.uiFramework || ""}
                                  onChange={(e) => {
                                    handleUpdateContext(activeContextId, {
                                      uiFramework: e.target
                                        .value as BoundedContextInput["uiFramework"],
                                    });
                                  }}
                                  className="w-full px-3 py-2 border rounded-md text-sm"
                                >
                                  <option value="">Select...</option>
                                  {uiFrameworkOptions.map((o) => (
                                    <option key={o} value={o}>
                                      {o}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="text-xs text-muted-foreground block mb-1">
                                  Persistence
                                </label>
                                <select
                                  value={activeContext.persistenceAdapter || ""}
                                  onChange={(e) => {
                                    handleUpdateContext(activeContextId, {
                                      persistenceAdapter: e.target
                                        .value as BoundedContextInput["persistenceAdapter"],
                                    });
                                  }}
                                  className="w-full px-3 py-2 border rounded-md text-sm"
                                >
                                  <option value="">Select...</option>
                                  {persistenceAdapterOptions.map((o) => (
                                    <option key={o} value={o}>
                                      {o}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="text-xs text-muted-foreground block mb-1">
                                  Messaging
                                </label>
                                <select
                                  value={activeContext.messagingAdapter || ""}
                                  onChange={(e) => {
                                    handleUpdateContext(activeContextId, {
                                      messagingAdapter: e.target
                                        .value as BoundedContextInput["messagingAdapter"],
                                    });
                                  }}
                                  className="w-full px-3 py-2 border rounded-md text-sm"
                                >
                                  <option value="">Select...</option>
                                  {messagingAdapterOptions.map((o) => (
                                    <option key={o} value={o}>
                                      {o}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          </div>

                          <div className="border-t pt-4">
                            <h3 className="text-sm font-medium mb-3">Domain</h3>
                            <div className="space-y-4">
                              <div>
                                <label className="text-xs text-muted-foreground block mb-1">
                                  Entities (comma-separated)
                                </label>
                                <input
                                  value={
                                    activeContext.entities?.join(",") || ""
                                  }
                                  onChange={(e) => {
                                    handleUpdateContext(activeContextId, {
                                      entities: e.target.value
                                        .split(",")
                                        .map((s) => s.trim())
                                        .filter(Boolean),
                                    });
                                  }}
                                  className="w-full px-3 py-2 border rounded-md text-sm"
                                  placeholder="User,Order,Product"
                                />
                              </div>
                              <div>
                                <label className="text-xs text-muted-foreground block mb-1">
                                  Use Cases (comma-separated)
                                </label>
                                <input
                                  value={
                                    activeContext.useCases?.join(",") || ""
                                  }
                                  onChange={(e) => {
                                    handleUpdateContext(activeContextId, {
                                      useCases: e.target.value
                                        .split(",")
                                        .map((s) => s.trim())
                                        .filter(Boolean),
                                    });
                                  }}
                                  className="w-full px-3 py-2 border rounded-md text-sm"
                                  placeholder="RegisterUser,PlaceOrder"
                                />
                              </div>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>

                <div className="mt-auto flex gap-3 pt-6 border-t">
                  {!isFirstStep && (
                    <PrimaryButton
                      variant="outline"
                      className="flex-1"
                      onClick={() =>
                        dispatchIntent({
                          type: "WIZARD_BACK",
                          source: "user",
                          payload: null,
                          metadata: { confidence: 1 },
                        })
                      }
                    >
                      Back
                    </PrimaryButton>
                  )}
                  <PrimaryButton
                    className="flex-1"
                    disabled={!canProceed || loading}
                    onClick={() =>
                      dispatchIntent({
                        type: isLastStep ? "GENERATE_PROJECT" : "WIZARD_NEXT",
                        source: "user",
                        payload: form.getValues(),
                        metadata: { confidence: 1 },
                      })
                    }
                  >
                    {isLastStep ? "Generate" : "Next"}
                  </PrimaryButton>
                </div>
              </CardContent>
            </Card>
          }
          middle={
            <Card className="h-full border-0 rounded-none overflow-hidden flex flex-col">
              <CardHeader>
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
            <Card className="h-full border-0 rounded-none">
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">
                  Monaco AI Architect
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
