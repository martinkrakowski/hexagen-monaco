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

interface BoundedContextStepProps {
  onNext: () => void;
  onBack: () => void;
  canProceed: boolean;
  activeContextId?: string;
  currentStep?: number;
  totalSteps?: number;
}

export function BoundedContextStep({
  onNext,
  onBack,
  canProceed,
  activeContextId,
  currentStep = 2,
  totalSteps = 4,
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

  const handleNext = () => {
    onNext();
  };

  if (boundedContexts.length === 0) {
    return (
      <div className="flex flex-col h-full bg-card overflow-hidden">
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="text-center">
            <h2 className="text-lg font-semibold text-foreground mb-2">
              No Bounded Contexts
            </h2>
            <p className="text-sm text-muted-foreground">
              Add a bounded context from the sidebar to get started.
            </p>
          </div>
        </div>
        <footer className="flex-shrink-0 bg-background border-t border-border p-4 flex justify-between items-center z-10">
          <button
            type="button"
            onClick={onBack}
            disabled={!canProceed}
            className="px-6 py-2 text-sm font-medium text-foreground bg-muted hover:bg-muted rounded-md transition-colors border border-input disabled:opacity-50"
          >
            Back
          </button>
          <div className="flex items-center gap-4">
            <span className="text-xs text-muted-foreground">
              Step {currentStep} of {totalSteps}
            </span>
            <button
              type="button"
              onClick={handleNext}
              disabled={
                !canProceed ||
                boundedContexts.some((c: BoundedContext) => !c.name?.trim())
              }
              className="px-8 py-2.5 text-sm font-bold text-primary-foreground bg-primary hover:bg-primary/90 rounded-md shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </footer>
      </div>
    );
  }

  if (!activeContext) {
    return (
      <div className="flex flex-col h-full bg-card overflow-hidden">
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="text-center">
            <p className="text-sm text-muted-foreground">
              Select a context to edit
            </p>
          </div>
        </div>
        <footer className="flex-shrink-0 bg-background border-t border-border p-4 flex justify-between items-center z-10">
          <button
            type="button"
            onClick={onBack}
            disabled={!canProceed}
            className="px-6 py-2 text-sm font-medium text-foreground bg-muted hover:bg-muted rounded-md transition-colors border border-input disabled:opacity-50"
          >
            Back
          </button>
          <div className="flex items-center gap-4">
            <span className="text-xs text-muted-foreground">
              Step {currentStep} of {totalSteps}
            </span>
            <button
              type="button"
              onClick={handleNext}
              disabled={
                !canProceed ||
                boundedContexts.some((c: BoundedContext) => !c.name?.trim())
              }
              className="px-8 py-2.5 text-sm font-bold text-primary-foreground bg-primary hover:bg-primary/90 rounded-md shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </footer>
      </div>
    );
  }

  if (!activeContext) {
    return (
      <div className="flex flex-col h-full bg-card overflow-hidden">
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="text-center">
            <p className="text-sm text-muted-foreground">
              Select a context to edit
            </p>
          </div>
        </div>
        <footer className="flex-shrink-0 bg-background border-t border-border p-4 flex justify-between items-center z-10">
          <button
            type="button"
            onClick={onBack}
            disabled={!canProceed}
            className="px-6 py-2 text-sm font-medium text-foreground bg-muted hover:bg-muted rounded-md transition-colors border border-input disabled:opacity-50"
          >
            Back
          </button>
          <div className="flex items-center gap-4">
            <span className="text-xs text-muted-foreground">
              Step {currentStep} of {totalSteps}
            </span>
            <button
              type="button"
              onClick={handleNext}
              disabled={
                !canProceed ||
                boundedContexts.some((c: BoundedContext) => !c.name?.trim())
              }
              className="px-8 py-2.5 text-sm font-bold text-primary-foreground bg-primary hover:bg-primary/90 rounded-md shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </footer>
      </div>
    );
  }

  const contextIndex = boundedContexts.findIndex(
    (c) => c.id === activeContextId,
  );
  const fieldPrefix = `boundedContexts.${contextIndex}`;

  return (
    <div className="flex flex-col h-full bg-card overflow-hidden">
      <div className="space-y-6">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">
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
              className="w-full px-3 py-2 border border-input rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              placeholder="e.g. SalesContext"
            />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">
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
                className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
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
              <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">
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
                className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              >
                {uiFrameworkOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">
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
                className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
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
              <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">
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
                className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
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
              <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">
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
                className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
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
      </div>

      {/* Zone B: Grid (Scrollable Middle) */}
      <div
        key={`zone-b-${activeContextId}`}
        className="flex-1 overflow-y-auto p-6"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Left Column: Domain Model */}
          <div>
            <div className="border-b border-border pb-2 mb-4 flex justify-between items-end">
              <div>
                <h3 className="text-sm font-bold text-foreground uppercase tracking-widest">
                  Domain Model
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Nouns &amp; State
                </p>
              </div>
            </div>

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

          {/* Right Column: Domain Logic */}
          <div>
            <div className="border-b border-border pb-2 mb-4 flex justify-between items-end">
              <div>
                <h3 className="text-sm font-bold text-foreground uppercase tracking-widest">
                  Domain Logic
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Verbs &amp; Action
                </p>
              </div>
            </div>

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

      {/* Zone C: Footer (Sticky Bottom) */}
      <footer className="flex-shrink-0 bg-background border-t border-border p-4 flex justify-between items-center z-10">
        <button
          type="button"
          onClick={onBack}
          disabled={!canProceed}
          className="px-6 py-2 text-sm font-medium text-foreground bg-muted hover:bg-muted rounded-md transition-colors border border-input disabled:opacity-50"
        >
          Back
        </button>
        <div className="flex items-center gap-4">
          <span className="text-xs text-muted-foreground">
            Step {currentStep} of {totalSteps}
          </span>
          <button
            type="button"
            onClick={handleNext}
            disabled={
              !canProceed ||
              boundedContexts.some((c: BoundedContext) => !c.name?.trim())
            }
            className="px-8 py-2.5 text-sm font-bold text-primary-foreground bg-primary hover:bg-primary/90 rounded-md shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      </footer>
    </div>
  );
}
