"use client";

import { useState, useEffect } from "react";
import { useFormContext } from "react-hook-form";
import type {
  ProjectConfig,
  PeerContextMapping,
} from "@hexagen/project-configuration";

interface PeerContextMappingStepProps {
  onNext: () => void;
  onBack: () => void;
  canProceed: boolean;
  activeMappingId?: string;
  currentStep?: number;
  totalSteps?: number;
}

function StepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex gap-2 mb-4">
      {[1, 2, 3, 4, 5].map((step) => (
        <div
          key={step}
          className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm ${
            currentStep === step
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-muted text-muted-foreground border-muted"
          }`}
        >
          {step}
        </div>
      ))}
    </div>
  );
}

export function PeerContextMappingStep({
  onNext,
  onBack,
  canProceed,
  activeMappingId,
  currentStep = 3,
  totalSteps = 5,
}: PeerContextMappingStepProps) {
  const { watch, setValue } = useFormContext<ProjectConfig>();
  const boundedContexts = watch("boundedContexts") || [];
  const peerMappings = watch("peerMappings") || [];
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    forceUpdate((n) => n + 1);
  }, [activeMappingId]);

  const contextNames = boundedContexts.map(
    (ctx: { id: string; name?: string }) => ({
      id: ctx.id,
      name: ctx.name || "Unnamed Context",
    }),
  );

  const getActiveMapping = (): PeerContextMapping | null => {
    if (!activeMappingId) return null;
    return (
      peerMappings.find(
        (m: PeerContextMapping) =>
          `${m.consumerContext}-${m.providerContext}` === activeMappingId,
      ) || null
    );
  };

  const activeMapping = getActiveMapping();
  const activeMappingIndex = peerMappings.findIndex(
    (m: PeerContextMapping) =>
      `${m.consumerContext}-${m.providerContext}` === activeMappingId,
  );

  const handleUpdateMapping = (updates: Partial<PeerContextMapping>) => {
    if (activeMappingIndex < 0) return;
    const newMappings = peerMappings.map(
      (mapping: PeerContextMapping, i: number) =>
        i === activeMappingIndex ? { ...mapping, ...updates } : mapping,
    );
    setValue("peerMappings", newMappings);
  };

  const getContextName = (id: string): string => {
    const ctx = boundedContexts.find((c: { id: string }) => c.id === id);
    return ctx?.name || "Unnamed";
  };

  if (boundedContexts.length < 2) {
    return (
      <div className="flex flex-col h-full bg-background overflow-hidden">
        <div className="flex-shrink-0 p-6 pb-4">
          <div className="text-[10px] font-mono bg-black text-green-400 p-2 rounded mb-4">
            STEP: {currentStep} (peer_context_mapping)
          </div>
          <StepIndicator currentStep={currentStep} />
          <h2 className="text-2xl font-semibold mb-2">Peer Context Mappings</h2>
          <p className="text-muted-foreground mb-6 text-sm">
            Define how contexts interact with each other.
          </p>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="text-center">
            <div className="border-2 border-dashed rounded-lg p-8 text-center bg-muted/30 max-w-md mx-auto">
              <p className="text-sm text-muted-foreground mb-2">
                At least 2 bounded contexts required to define peer mappings.
              </p>
              <p className="text-xs text-muted-foreground">
                Add more contexts in the previous step.
              </p>
            </div>
          </div>
        </div>
        <footer className="flex-shrink-0 bg-background border-t border-border p-4 flex justify-between items-center z-10">
          <button
            type="button"
            onClick={onBack}
            className="px-6 py-2 text-sm font-medium text-foreground bg-muted hover:bg-muted rounded-md transition-colors border border-input"
          >
            Back
          </button>
          <div className="flex items-center gap-4">
            <span className="text-xs text-muted-foreground">
              Step {currentStep} of {totalSteps}
            </span>
            <button
              type="button"
              onClick={onNext}
              className="px-8 py-2.5 text-sm font-bold text-primary-foreground bg-primary hover:bg-primary/90 rounded-md shadow-sm transition-colors"
            >
              Next
            </button>
          </div>
        </footer>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* Zone A: Mapping Info (Fixed Top) */}
      <header
        key={`header-${activeMappingId}`}
        className="flex-shrink-0 p-6 pb-4 bg-muted/50"
      >
        <div className="text-[10px] font-mono bg-black text-green-400 p-2 rounded mb-4">
          STEP: {currentStep} (peer_context_mapping)
        </div>
        <StepIndicator currentStep={currentStep} />
        <h2 className="text-2xl font-semibold mb-2">Peer Context Mappings</h2>
        <p className="text-muted-foreground mb-6 text-sm">
          Define how contexts interact with each other.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">
              Consumer Context (Source)
            </label>
            <select
              value={activeMapping?.consumerContext || ""}
              onChange={(e) =>
                handleUpdateMapping({
                  consumerContext: e.target.value,
                })
              }
              disabled={!activeMapping}
              className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background focus:ring-2 focus:ring-primary focus:border-transparent outline-none disabled:bg-muted disabled:cursor-not-allowed"
            >
              <option value="" disabled>
                Select Consumer
              </option>
              {contextNames.map((ctx) => (
                <option key={ctx.id} value={ctx.id}>
                  {ctx.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">
              Provider Context (Target)
            </label>
            <select
              value={activeMapping?.providerContext || ""}
              onChange={(e) =>
                handleUpdateMapping({
                  providerContext: e.target.value,
                })
              }
              disabled={!activeMapping}
              className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background focus:ring-2 focus:ring-primary focus:border-transparent outline-none disabled:bg-muted disabled:cursor-not-allowed"
            >
              <option value="" disabled>
                Select Provider
              </option>
              {contextNames.map((ctx) => (
                <option key={ctx.id} value={ctx.id}>
                  {ctx.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {/* Zone B: Grid (Scrollable Middle) */}
      <div
        key={`zone-b-${activeMappingId}`}
        className="flex-1 overflow-y-auto p-6"
      >
        {!activeMapping ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">
                Select a mapping from the sidebar to edit
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
              <div className="border-b border-border pb-2 mb-4 flex justify-between items-end">
                <div>
                  <h3 className="text-sm font-bold text-foreground uppercase tracking-widest">
                    Integration Details
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {getContextName(activeMapping.consumerContext)} →{" "}
                    {getContextName(activeMapping.providerContext)}
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">
                    Integration Pattern
                  </label>
                  <select
                    value={activeMapping.integrationPattern}
                    onChange={(e) =>
                      handleUpdateMapping({
                        integrationPattern: e.target.value as
                          | "open-host"
                          | "acl",
                      })
                    }
                    className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
                  >
                    <option value="open-host">Open Host Service (OHS)</option>
                    <option value="acl">Anticorruption Layer (ACL)</option>
                  </select>
                </div>
              </div>
            </div>

            <div>
              <div className="border-b border-border pb-2 mb-4 flex justify-between items-end">
                <div>
                  <h3 className="text-sm font-bold text-foreground uppercase tracking-widest">
                    Communication
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    How contexts communicate
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">
                    Communication Boundary
                  </label>
                  <select
                    value={activeMapping.communicationBoundary}
                    onChange={(e) =>
                      handleUpdateMapping({
                        communicationBoundary: e.target.value as
                          | "in-process"
                          | "networked",
                      })
                    }
                    className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
                  >
                    <option value="in-process">In-Process</option>
                    <option value="networked">Networked</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}
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
            onClick={onNext}
            className="px-8 py-2.5 text-sm font-bold text-primary-foreground bg-primary hover:bg-primary/90 rounded-md shadow-sm transition-colors"
          >
            Next
          </button>
        </div>
      </footer>
    </div>
  );
}
