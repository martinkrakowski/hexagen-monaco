"use client";

import { useState, useCallback } from "react";
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
import type { WizardData } from "@hexagen/shared";

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
  const [editingContextIndex, setEditingContextIndex] = useState<number>(0);

  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === wizardSteps.length - 1;

  const form = useForm<ProjectConfig>({
    resolver: zodResolver(projectConfigSchema),
    defaultValues: emptyFormValues,
    mode: "all",
  });

  const watchedValues = useWatch({ control: form.control });
  const currentStep = wizardSteps[currentStepIndex];

  const canProceed =
    currentStepIndex === 1
      ? (watchedValues.boundedContexts?.length ?? 0) > 0 &&
        (watchedValues.boundedContexts?.every((c) => c.name?.trim()) ?? false)
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
          setEditingContextIndex(0);
          break;
      }
    },
    [form, currentStepIndex],
  );

  const initialManifest = JSON.stringify(watchedValues, null, 2);
  const sessionId = "wizard-session-1";

  const boundedContexts = watchedValues.boundedContexts || [];
  const externalContexts = watchedValues.externalContexts || [];
  const activeContext = boundedContexts[editingContextIndex];

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
                              const current =
                                watchedValues.boundedContexts || [];
                              form.setValue(
                                "boundedContexts",
                                [
                                  ...current,
                                  { id: crypto.randomUUID(), name: "" },
                                ],
                                { shouldDirty: true },
                              );
                              setEditingContextIndex(current.length);
                            }}
                            className="text-xs px-2 py-1 bg-secondary rounded"
                          >
                            + Add Context
                          </button>
                        </div>
                        {boundedContexts.map(
                          (ctx: BoundedContextInput, idx: number) => (
                            <div key={ctx.id} className="flex gap-2 mb-2">
                              <input
                                value={ctx.name || ""}
                                onChange={(e) => {
                                  const updated = [...boundedContexts];
                                  updated[idx] = {
                                    ...updated[idx],
                                    name: e.target.value,
                                  };
                                  form.setValue("boundedContexts", updated, {
                                    shouldDirty: true,
                                  });
                                }}
                                className="flex-1 px-2 py-1 text-sm border rounded"
                                placeholder="context name"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const updated = boundedContexts.filter(
                                    (_: BoundedContextInput, i: number) =>
                                      i !== idx,
                                  );
                                  form.setValue("boundedContexts", updated, {
                                    shouldDirty: true,
                                  });
                                  if (editingContextIndex >= updated.length) {
                                    setEditingContextIndex(
                                      Math.max(0, updated.length - 1),
                                    );
                                  }
                                }}
                                className="text-muted-foreground hover:text-destructive"
                              >
                                ✕
                              </button>
                            </div>
                          ),
                        )}
                        {boundedContexts.length === 0 && (
                          <p className="text-xs text-muted-foreground">
                            Add at least one bounded context.
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Step 3: Configure Context */}
                  {currentStepIndex === 2 && boundedContexts.length > 0 && (
                    <div className="space-y-6">
                      <div className="mb-4 p-3 border rounded-lg bg-muted/30">
                        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-2">
                          Editing Context
                        </label>
                        <div className="flex gap-2 flex-wrap">
                          {boundedContexts.map(
                            (ctx: BoundedContextInput, idx: number) => (
                              <button
                                key={ctx.id}
                                type="button"
                                onClick={() => setEditingContextIndex(idx)}
                                className={`px-3 py-1.5 text-sm rounded-md border ${
                                  editingContextIndex === idx
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "bg-background border-border hover:bg-muted"
                                }`}
                              >
                                {ctx.name || `Context ${idx + 1}`}
                              </button>
                            ),
                          )}
                        </div>
                      </div>

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
                                    const updated = [...boundedContexts];
                                    updated[editingContextIndex] = {
                                      ...updated[editingContextIndex],
                                      apiFramework: e.target
                                        .value as BoundedContextInput["apiFramework"],
                                    };
                                    form.setValue("boundedContexts", updated, {
                                      shouldDirty: true,
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
                                    const updated = [...boundedContexts];
                                    updated[editingContextIndex] = {
                                      ...updated[editingContextIndex],
                                      uiFramework: e.target
                                        .value as BoundedContextInput["uiFramework"],
                                    };
                                    form.setValue("boundedContexts", updated, {
                                      shouldDirty: true,
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
                                    const updated = [...boundedContexts];
                                    updated[editingContextIndex] = {
                                      ...updated[editingContextIndex],
                                      persistenceAdapter: e.target
                                        .value as BoundedContextInput["persistenceAdapter"],
                                    };
                                    form.setValue("boundedContexts", updated, {
                                      shouldDirty: true,
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
                                    const updated = [...boundedContexts];
                                    updated[editingContextIndex] = {
                                      ...updated[editingContextIndex],
                                      messagingAdapter: e.target
                                        .value as BoundedContextInput["messagingAdapter"],
                                    };
                                    form.setValue("boundedContexts", updated, {
                                      shouldDirty: true,
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
                                    const updated = [...boundedContexts];
                                    updated[editingContextIndex] = {
                                      ...updated[editingContextIndex],
                                      entities: e.target.value
                                        .split(",")
                                        .map((s) => s.trim())
                                        .filter(Boolean),
                                    };
                                    form.setValue("boundedContexts", updated, {
                                      shouldDirty: true,
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
                                    const updated = [...boundedContexts];
                                    updated[editingContextIndex] = {
                                      ...updated[editingContextIndex],
                                      useCases: e.target.value
                                        .split(",")
                                        .map((s) => s.trim())
                                        .filter(Boolean),
                                    };
                                    form.setValue("boundedContexts", updated, {
                                      shouldDirty: true,
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

                  {/* Step 4: External Contexts */}
                  {currentStepIndex === 3 && (
                    <div className="space-y-6">
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          External/Peer Contexts
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
                          + Add
                        </button>
                      </div>
                      {externalContexts.map(
                        (ctx: ExternalContextInput, idx: number) => (
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
                                  (_: ExternalContextInput, i: number) =>
                                    i !== idx,
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
                        ),
                      )}
                      {externalContexts.length === 0 && (
                        <p className="text-xs text-muted-foreground">
                          No external contexts defined.
                        </p>
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
                <GraphCanvasWrapper
                  projectId="demo"
                  wizardData={
                    {
                      boundedContexts:
                        watchedValues.boundedContexts as WizardData["boundedContexts"],
                      externalContexts:
                        watchedValues.externalContexts as WizardData["externalContexts"],
                      workspaceScope: watchedValues.workspaceScope,
                      withLlm: watchedValues.withLlm,
                      withBlockchain: watchedValues.withBlockchain,
                    } as WizardData
                  }
                />
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
