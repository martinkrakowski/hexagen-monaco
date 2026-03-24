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
      <div className="flex flex-col h-full bg-white overflow-hidden">
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="text-center">
            <h2 className="text-lg font-semibold text-slate-700 mb-2">
              No Bounded Contexts
            </h2>
            <p className="text-sm text-slate-500">
              Add a bounded context from the sidebar to get started.
            </p>
          </div>
        </div>
        <footer className="flex-shrink-0 bg-white border-t border-slate-200 p-4 flex justify-between items-center z-10">
          <button
            type="button"
            onClick={onBack}
            disabled={!canProceed}
            className="px-6 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors border border-slate-300 disabled:opacity-50"
          >
            Back
          </button>
          <div className="flex items-center gap-4">
            <span className="text-xs text-slate-400">
              Step {currentStep} of {totalSteps}
            </span>
            <button
              type="button"
              onClick={handleNext}
              disabled={
                !canProceed ||
                boundedContexts.some((c: BoundedContext) => !c.name?.trim())
              }
              className="px-8 py-2.5 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
      <div className="flex flex-col h-full bg-white overflow-hidden">
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="text-center">
            <p className="text-sm text-slate-500">Select a context to edit</p>
          </div>
        </div>
        <footer className="flex-shrink-0 bg-white border-t border-slate-200 p-4 flex justify-between items-center z-10">
          <button
            type="button"
            onClick={onBack}
            disabled={!canProceed}
            className="px-6 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors border border-slate-300 disabled:opacity-50"
          >
            Back
          </button>
          <div className="flex items-center gap-4">
            <span className="text-xs text-slate-400">
              Step {currentStep} of {totalSteps}
            </span>
            <button
              type="button"
              onClick={handleNext}
              disabled={
                !canProceed ||
                boundedContexts.some((c: BoundedContext) => !c.name?.trim())
              }
              className="px-8 py-2.5 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* Zone A: Identity (Fixed Top) */}
      <header
        key={`header-${activeContextId}`}
        className="flex-shrink-0 border-b border-slate-100 p-6 bg-slate-50/50"
      >
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">
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
              className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              placeholder="e.g. SalesContext"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">
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
              className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
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
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">
              UI Frontend
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
              className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            >
              <option value="None">None</option>
              {telemetryProviderOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">
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
              className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
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
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">
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
              className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
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
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">
              Telemetry
            </label>
            <select
              value={activeContext.telemetryProvider || "None"}
              onChange={(e) =>
                updateContext(contextIndex, (ctx) => ({
                  ...ctx,
                  telemetryProvider: e.target
                    .value as BoundedContext["telemetryProvider"],
                }))
              }
              className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            >
              <option value="None">None</option>
              {telemetryProviderOptions
                .filter((t) => t !== "None")
                .map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
            </select>
          </div>
        </div>
      </header>

      {/* Zone B: Grid (Scrollable Middle) */}
      <div
        key={`zone-b-${activeContextId}`}
        className="flex-1 overflow-y-auto p-6"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Left Column: Domain Model */}
          <div>
            <div className="border-b border-slate-200 pb-2 mb-4 flex justify-between items-end">
              <div>
                <h3 className="text-sm font-bold text-slate-700 uppercase tracking-widest">
                  Domain Model
                </h3>
                <p className="text-xs text-slate-400 mt-1">Nouns &amp; State</p>
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
              stableHeight
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
              stableHeight
            />
          </div>

          {/* Right Column: Domain Logic */}
          <div>
            <div className="border-b border-slate-200 pb-2 mb-4 flex justify-between items-end">
              <div>
                <h3 className="text-sm font-bold text-slate-700 uppercase tracking-widest">
                  Domain Logic
                </h3>
                <p className="text-xs text-slate-400 mt-1">
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
              stableHeight
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
              stableHeight
            />
          </div>
        </div>
      </div>

      {/* Zone C: Footer (Sticky Bottom) */}
      <footer className="flex-shrink-0 bg-white border-t border-slate-200 p-4 flex justify-between items-center z-10">
        <button
          type="button"
          onClick={onBack}
          disabled={!canProceed}
          className="px-6 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors border border-slate-300 disabled:opacity-50"
        >
          Back
        </button>
        <div className="flex items-center gap-4">
          <span className="text-xs text-slate-400">
            Step {currentStep} of {totalSteps}
          </span>
          <button
            type="button"
            onClick={handleNext}
            disabled={
              !canProceed ||
              boundedContexts.some((c: BoundedContext) => !c.name?.trim())
            }
            className="px-8 py-2.5 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      </footer>
    </div>
  );
}
