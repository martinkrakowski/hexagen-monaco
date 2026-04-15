"use client";

import { useState } from "react";
import { useFormContext } from "react-hook-form";
import { ChipInput } from "./ChipInput";
import { ArrowLeft, Plus, AlertTriangle, X } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import type {
  ProjectConfig,
  BoundedContext,
} from "@hexagen/project-configuration";
import {
  apiFrameworkOptions,
  uiFrameworkOptions,
  persistenceAdapterOptions,
  messagingAdapterOptions,
  telemetryProviderOptions,
} from "../config";
import { StepHeader } from "./StepHeader";
import { WizardFooter } from "../WizardFooter";

interface BoundedContextStepProps {
  onNext: () => void;
  onBack: () => void;
  canProceed: boolean;
  activeContextId?: string;
  onContextSelect?: (id: string) => void;
  currentStep?: number;
  totalSteps?: number;
  title?: string;
  description?: string;
}

export function BoundedContextStep({
  onNext,
  onBack,
  canProceed,
  activeContextId,
  onContextSelect,
  currentStep = 2,
  totalSteps = 6,
  title,
  description,
}: BoundedContextStepProps) {
  const { watch, setValue } = useFormContext<ProjectConfig>();
  const boundedContexts = watch("boundedContexts") || [];

  const [view, setView] = useState<"menu" | "form">("menu");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const activeContext = boundedContexts.find((c) => c.id === activeContextId);

  const updateContext = (
    index: number,
    updater: (ctx: BoundedContext) => BoundedContext,
  ) => {
    const nextContexts = boundedContexts.map(
      (ctx: BoundedContext, i: number) => (i === index ? updater(ctx) : ctx),
    );
    setValue("boundedContexts", nextContexts, {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  const isNextDisabled =
    !canProceed || boundedContexts.some((c: BoundedContext) => !c.name?.trim());

  const handleAddContext = () => {
    const newContext: BoundedContext = {
      id: uuidv4(),
      name: "",
      description: "",
      infrastructureTarget: "nestjs",
      coreDomainEntities: [],
      valueObjects: [],
      domainEvents: [],
      entities: [],
      useCases: [],
      portConfiguration: {
        inboundPorts: [],
        outboundPorts: [],
      },
      apiFramework: "NestJS",
      uiFramework: "",
      persistenceAdapter: "",
      messagingAdapter: "",
      telemetryProvider: "",
      externalApiPorts: [],
      llmProviders: [],
      blockchainNetworks: [],
      authenticationProvider: "",
      emailService: "",
      paymentGateway: "",
      storageProvider: "",
      searchService: "",
      webhookEndpoints: [],
    };
    const newContexts = [...boundedContexts, newContext];
    setValue("boundedContexts", newContexts);
    onContextSelect?.(newContext.id);
    setView("form");
  };

  const handleBack = () => {
    setView("menu");
  };

  const handleDeleteContext = (contextId: string) => {
    const indexToDelete = boundedContexts.findIndex((c) => c.id === contextId);
    if (indexToDelete >= 0) {
      const newContexts = [...boundedContexts];
      newContexts.splice(indexToDelete, 1);
      setValue("boundedContexts", newContexts);
      if (activeContextId === contextId) {
        if (newContexts.length > 0) {
          const newActiveIndex = Math.min(
            indexToDelete,
            newContexts.length - 1,
          );
          onContextSelect?.(newContexts[newActiveIndex].id);
          setView("menu");
        } else {
          onContextSelect?.("");
        }
      }
    }
    setConfirmDeleteId(null);
  };

  const renderMenuView = () => (
    <div className="flex-1 min-h-0 overflow-y-auto p-4">
      <div className="space-y-2">
        {boundedContexts.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-sm text-muted-foreground mb-4">
              No bounded contexts yet.
            </p>
            <p className="text-xs text-muted-foreground">
              Add a context to get started.
            </p>
          </div>
        ) : (
          boundedContexts.map((ctx: BoundedContext) => (
            <div
              key={ctx.id}
              className={`relative w-full text-left p-4 border border-border rounded-lg cursor-pointer transition-colors ${
                activeContextId === ctx.id
                  ? "border-primary bg-primary/10"
                  : "border-border bg-background hover:border-input"
              }`}
              onClick={() => {
                onContextSelect?.(ctx.id);
                setView("form");
              }}
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded bg-muted text-muted-foreground">
                  <span className="font-bold">
                    {ctx.name?.charAt(0).toUpperCase() || "?"}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-sm text-foreground truncate">
                    {ctx.name || "Unnamed Context"}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {(ctx.coreDomainEntities?.length ?? 0) +
                      (ctx.useCases?.length ?? 0)}{" "}
                    items
                  </p>
                </div>
              </div>
              {boundedContexts.length > 1 &&
                (confirmDeleteId === ctx.id ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/95 backdrop-blur-sm rounded-lg gap-2">
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                    <span className="text-xs font-medium text-destructive">
                      Delete?
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteContext(ctx.id);
                      }}
                      className="px-2 py-1 text-xs font-medium bg-destructive text-destructive-foreground rounded"
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteId(null);
                      }}
                      className="px-2 py-1 text-xs font-medium bg-muted rounded"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <X
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDeleteId(ctx.id);
                    }}
                    className="absolute top-2 right-2 p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                  />
                ))}
            </div>
          ))
        )}
      </div>
      <button
        type="button"
        onClick={handleAddContext}
        className="w-full mt-4 py-3 px-4 border border-dashed border-input rounded-lg text-sm text-muted-foreground hover:border-primary hover:text-primary hover:bg-primary/5 transition-colors flex items-center justify-center gap-2"
      >
        <Plus className="h-4 w-4" />
        Add Context
      </button>
    </div>
  );

  const renderFormView = () => {
    if (!activeContext) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">
            Select a context to edit
          </p>
        </div>
      );
    }

    const contextIndex = boundedContexts.findIndex(
      (c) => c.id === activeContextId,
    );
    const fieldPrefix = `boundedContexts.${contextIndex}`;

    return (
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="shrink-0 p-2 space-y-3 border-b border-border">
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to context list
          </button>
          <div className="w-full">
            <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1.5">
              Context Name
            </label>
            <input
              type="text"
              value={activeContext.name}
              onChange={(e) =>
                updateContext(contextIndex, (ctx) => ({
                  ...ctx,
                  name: e.target.value,
                }))
              }
              className="w-full px-3 py-2 border border-input rounded-md text-sm focus:ring-2 focus:ring-ring focus:border-transparent outline-none bg-background"
              placeholder="e.g. SalesContext"
            />
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1.5">
                API Backend
              </label>
              <select
                value={activeContext.infrastructureTarget || ""}
                onChange={(e) =>
                  updateContext(contextIndex, (ctx) => ({
                    ...ctx,
                    infrastructureTarget: e.target
                      .value as BoundedContext["infrastructureTarget"],
                  }))
                }
                className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background focus:ring-2 focus:ring-ring focus:border-transparent outline-none"
              >
                <option value="" disabled>
                  Select Backend
                </option>
                {apiFrameworkOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1.5">
                UI Frontend
              </label>
              <select
                value={activeContext.uiFramework || ""}
                onChange={(e) =>
                  updateContext(contextIndex, (ctx) => ({
                    ...ctx,
                    uiFramework: e.target
                      .value as BoundedContext["uiFramework"],
                  }))
                }
                className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background focus:ring-2 focus:ring-ring focus:border-transparent outline-none"
              >
                {uiFrameworkOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1.5">
                Persistence
              </label>
              <select
                value={activeContext.persistenceAdapter || ""}
                onChange={(e) =>
                  updateContext(contextIndex, (ctx) => ({
                    ...ctx,
                    persistenceAdapter: e.target
                      .value as BoundedContext["persistenceAdapter"],
                  }))
                }
                className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background focus:ring-2 focus:ring-ring focus:border-transparent outline-none"
              >
                <option value="">None</option>
                {persistenceAdapterOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1.5">
                Messaging
              </label>
              <select
                value={activeContext.messagingAdapter || ""}
                onChange={(e) =>
                  updateContext(contextIndex, (ctx) => ({
                    ...ctx,
                    messagingAdapter: e.target
                      .value as BoundedContext["messagingAdapter"],
                  }))
                }
                className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background focus:ring-2 focus:ring-ring focus:border-transparent outline-none"
              >
                <option value="">None</option>
                {messagingAdapterOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1.5">
                Telemetry
              </label>
              <select
                value={activeContext.telemetryProvider || "None"}
                onChange={(e) =>
                  updateContext(contextIndex, (ctx) => ({
                    ...ctx,
                    telemetryProvider: e.target
                      .value as unknown as BoundedContext["telemetryProvider"],
                  }))
                }
                className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background focus:ring-2 focus:ring-ring focus:border-transparent outline-none"
              >
                {telemetryProviderOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="space-y-6 p-2">
          <div className="w-full">
            <div className="w-full border-b border-border mb-4 p-3">
              <h3 className="text-sm font-bold text-foreground uppercase tracking-widest">
                Domain Model
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                Nouns & State
              </p>
            </div>
            <div className="p-2 space-y-4">
              <ChipInput
                label="Core Domain Entities"
                placeholder="e.g. User, Product"
                name={`${fieldPrefix}.coreDomainEntities`}
                values={activeContext.coreDomainEntities || []}
                onChange={(values) =>
                  updateContext(contextIndex, (ctx) => ({
                    ...ctx,
                    coreDomainEntities: values,
                  }))
                }
              />
              <ChipInput
                label="Value Objects"
                placeholder="e.g. Money, Address"
                name={`${fieldPrefix}.valueObjects`}
                values={activeContext.valueObjects || []}
                onChange={(values) =>
                  updateContext(contextIndex, (ctx) => ({
                    ...ctx,
                    valueObjects: values,
                  }))
                }
              />
            </div>
          </div>

          <div className="w-full">
            <div className="w-full border-b border-t border-border mb-4 p-3">
              <h3 className="text-sm font-bold text-foreground uppercase tracking-widest">
                Domain Logic
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                Verbs & Action
              </p>
            </div>
            <div className="p-2 space-y-4">
              <ChipInput
                label="Primary Use Cases"
                placeholder="e.g. PlaceOrder"
                name={`${fieldPrefix}.useCases`}
                values={activeContext.useCases || []}
                onChange={(values) =>
                  updateContext(contextIndex, (ctx) => ({
                    ...ctx,
                    useCases: values,
                  }))
                }
              />
              <ChipInput
                label="Domain Events"
                placeholder="e.g. OrderPlaced"
                name={`${fieldPrefix}.domainEvents`}
                values={activeContext.domainEvents || []}
                onChange={(values) =>
                  updateContext(contextIndex, (ctx) => ({
                    ...ctx,
                    domainEvents: values,
                  }))
                }
              />
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-card">
      <StepHeader
        currentStep={currentStep}
        totalSteps={totalSteps}
        title={title || "Bounded Contexts"}
        description={description || "Add and configure bounded contexts."}
      />

      {view === "menu" ? renderMenuView() : renderFormView()}

      <WizardFooter
        onBack={onBack}
        onNext={onNext}
        canProceed={!isNextDisabled}
        currentStep={currentStep}
        totalSteps={totalSteps}
      />
    </div>
  );
}
