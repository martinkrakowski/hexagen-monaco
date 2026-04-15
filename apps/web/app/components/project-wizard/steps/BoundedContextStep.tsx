"use client";

import { useState, useEffect } from "react";
import { useFormContext } from "react-hook-form";
import { ChipInput } from "./ChipInput";
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
  currentStep = 2,
  totalSteps = 6,
  title,
  description,
}: BoundedContextStepProps) {
  const { watch, setValue } = useFormContext<ProjectConfig>();
  const boundedContexts = watch("boundedContexts") || [];
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    forceUpdate((n) => n + 1);
  }, [activeContextId]);

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

  const contextIndex = boundedContexts.findIndex(
    (c) => c.id === activeContextId,
  );
  const fieldPrefix = `boundedContexts.${contextIndex}`;

  const isNextDisabled =
    !canProceed || boundedContexts.some((c: BoundedContext) => !c.name?.trim());

  if (boundedContexts.length === 0) {
    return (
      <div className="flex flex-col h-full bg-card">
        <StepHeader
          currentStep={currentStep}
          totalSteps={totalSteps}
          title={title || "Bounded Contexts"}
          description={description || "Add and configure bounded contexts."}
        />
        <div className="flex-1 flex flex-col items-center justify-center min-h-0 px-4">
          <div className="text-center">
            <h2 className="text-lg font-semibold text-foreground mb-2">
              No Bounded Contexts
            </h2>
            <p className="text-sm text-muted-foreground">
              Add a bounded context from the sidebar to get started.
            </p>
          </div>
        </div>
        <WizardFooter
          onBack={onBack}
          onNext={onNext}
          canProceed={canProceed}
          currentStep={currentStep}
          totalSteps={totalSteps}
        />
      </div>
    );
  }

  if (!activeContext) {
    return (
      <div className="flex flex-col h-full bg-card">
        <StepHeader
          currentStep={currentStep}
          totalSteps={totalSteps}
          title={title || "Bounded Contexts"}
          description={description || "Add and configure bounded contexts."}
        />
        <div className="flex-1 flex flex-col items-center justify-center min-h-0 px-4">
          <div className="text-center">
            <p className="text-sm text-muted-foreground">
              Select a context to edit
            </p>
          </div>
        </div>
        <WizardFooter
          onBack={onBack}
          onNext={onNext}
          canProceed={canProceed}
          currentStep={currentStep}
          totalSteps={totalSteps}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-card">
      <StepHeader
        currentStep={currentStep}
        totalSteps={totalSteps}
        title={title || "Bounded Contexts"}
        description={description || "Add and configure bounded contexts."}
      />

      {/* Scrollable form content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Zone A: Context Name and Selectors */}
        <div className="shrink-0 p-2 space-y-3 border-b border-border">
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

        {/* Zone B: Domain Model and Domain Logic */}
        <div key={`zone-b-${activeContextId}`} className="space-y-6 p-2">
          {/* Domain Model - Full Width */}
          <div className="w-full">
            <div className="w-full border-b border-border mb-4 p-3">
              <h3 className="text-sm font-bold text-foreground uppercase tracking-widest">
                Domain Model
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                Nouns &amp; State
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

          {/* Domain Logic - Full Width, Below Domain Model */}
          <div className="w-full">
            <div className="w-full border-b border-t border-border mb-4 p-3">
              <h3 className="text-sm font-bold text-foreground uppercase tracking-widest">
                Domain Logic
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                Verbs &amp; Action
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

      {/* Fixed Footer */}
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
