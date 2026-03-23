"use client";

import { useFormContext } from "react-hook-form";
import type {
  ProjectConfig,
  PeerContextMapping,
} from "@hexagen/project-configuration";

interface PeerContextMappingStepProps {
  onNext: () => void;
  onBack: () => void;
  canProceed: boolean;
  currentStep?: number;
  totalSteps?: number;
}

export function PeerContextMappingStep({
  onNext,
  onBack,
  canProceed,
  currentStep = 3,
  totalSteps = 4,
}: PeerContextMappingStepProps) {
  const { watch, setValue } = useFormContext<ProjectConfig>();

  const boundedContexts = watch("boundedContexts") || [];
  const peerMappings = watch("peerMappings") || [];

  const contextNames = boundedContexts.map((ctx) => ({
    id: ctx.id,
    name: ctx.name || "Unnamed Context",
  }));

  const handleAddMapping = () => {
    if (boundedContexts.length < 2) return;

    const newMapping: PeerContextMapping = {
      consumerContext: boundedContexts[0]?.id || "",
      providerContext: boundedContexts[1]?.id || "",
      integrationPattern: "open-host",
      communicationBoundary: "in-process",
    };
    setValue("peerMappings", [...peerMappings, newMapping]);
  };

  const handleRemoveMapping = (index: number) => {
    const newMappings = [...peerMappings];
    newMappings.splice(index, 1);
    setValue("peerMappings", newMappings);
  };

  const handleUpdateMapping = (
    index: number,
    updates: Partial<PeerContextMapping>,
  ) => {
    const newMappings = peerMappings.map((mapping, i) =>
      i === index ? { ...mapping, ...updates } : mapping,
    );
    setValue("peerMappings", newMappings);
  };

  if (boundedContexts.length < 2) {
    return (
      <div className="flex flex-col h-full bg-white overflow-hidden">
        <div className="flex-shrink-0 p-6 pb-4">
          <div className="text-[10px] font-mono bg-black text-green-400 p-2 rounded mb-4">
            STEP: 3 (peer_context_mapping)
          </div>
          <div className="flex gap-2 mb-4">
            <div className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm bg-muted text-muted-foreground border-muted">
              1
            </div>
            <div className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm bg-muted text-muted-foreground border-muted">
              2
            </div>
            <div className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm bg-primary text-primary-foreground border-primary">
              3
            </div>
            <div className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm bg-muted text-muted-foreground border-muted">
              4
            </div>
            <div className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm bg-muted text-muted-foreground border-muted">
              5
            </div>
          </div>
          <h2 className="text-2xl font-semibold mb-2">Peer Context Mappings</h2>
          <p className="text-muted-foreground mb-6 text-sm">
            Define how contexts interact with each other.
          </p>
        </div>
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          <div className="space-y-6 max-w-2xl">
            <div className="border-2 border-dashed rounded-lg p-8 text-center bg-muted/30">
              <p className="text-sm text-muted-foreground mb-2">
                At least 2 bounded contexts required to define peer mappings.
              </p>
              <p className="text-xs text-muted-foreground">
                Add more contexts in the previous step.
              </p>
            </div>
          </div>
        </div>

        <footer className="flex-shrink-0 bg-white border-t border-slate-200 p-4 flex justify-between items-center z-10">
          <button
            type="button"
            onClick={onBack}
            className="px-6 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors border border-slate-300"
          >
            Back
          </button>
          <div className="flex items-center gap-4">
            <span className="text-xs text-slate-400">
              Step {currentStep} of {totalSteps}
            </span>
            <button
              type="button"
              onClick={onNext}
              className="px-8 py-2.5 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm transition-colors"
            >
              Next
            </button>
          </div>
        </footer>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      <div className="flex-shrink-0 p-6 pb-4">
        <div className="text-[10px] font-mono bg-black text-green-400 p-2 rounded mb-4">
          STEP: 3 (peer_context_mapping)
        </div>
        <div className="flex gap-2 mb-4">
          <div className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm bg-muted text-muted-foreground border-muted">
            1
          </div>
          <div className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm bg-muted text-muted-foreground border-muted">
            2
          </div>
          <div className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm bg-primary text-primary-foreground border-primary">
            3
          </div>
          <div className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm bg-muted text-muted-foreground border-muted">
            4
          </div>
          <div className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm bg-muted text-muted-foreground border-muted">
            5
          </div>
        </div>
        <h2 className="text-2xl font-semibold mb-2">Peer Context Mappings</h2>
        <p className="text-muted-foreground mb-6 text-sm">
          Define how contexts interact with each other.
        </p>
      </div>
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <div className="space-y-6 max-w-2xl">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold">Peer Context Mappings</h2>
              <p className="text-sm text-muted-foreground">
                Define how contexts interact with each other
              </p>
            </div>
            <button
              type="button"
              onClick={handleAddMapping}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 transition-colors"
            >
              Add Mapping
            </button>
          </div>

          {peerMappings.length === 0 ? (
            <div className="border-2 border-dashed rounded-lg p-8 text-center bg-muted/30">
              <p className="text-sm text-muted-foreground">
                No mappings defined. Contexts will operate independently.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {peerMappings.map(
                (mapping: PeerContextMapping, index: number) => (
                  <div
                    key={index}
                    className="border rounded-lg p-4 space-y-4 bg-card"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-muted-foreground">
                        Mapping {index + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveMapping(index)}
                        className="px-2 py-1 text-xs text-destructive hover:text-destructive/90 transition-colors"
                      >
                        Remove
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">
                          Consumer Context
                        </label>
                        <select
                          value={mapping.consumerContext}
                          onChange={(e) =>
                            handleUpdateMapping(index, {
                              consumerContext: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm"
                        >
                          {contextNames.map((ctx) => (
                            <option key={ctx.id} value={ctx.id}>
                              {ctx.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">
                          Provider Context
                        </label>
                        <select
                          value={mapping.providerContext}
                          onChange={(e) =>
                            handleUpdateMapping(index, {
                              providerContext: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm"
                        >
                          {contextNames.map((ctx) => (
                            <option key={ctx.id} value={ctx.id}>
                              {ctx.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">
                          Integration Pattern
                        </label>
                        <select
                          value={mapping.integrationPattern}
                          onChange={(e) =>
                            handleUpdateMapping(index, {
                              integrationPattern: e.target.value as
                                | "open-host"
                                | "acl",
                            })
                          }
                          className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm"
                        >
                          <option value="open-host">Open Host Service</option>
                          <option value="acl">
                            Anticorruption Layer (ACL)
                          </option>
                        </select>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">
                          Communication Boundary
                        </label>
                        <select
                          value={mapping.communicationBoundary}
                          onChange={(e) =>
                            handleUpdateMapping(index, {
                              communicationBoundary: e.target.value as
                                | "in-process"
                                | "networked",
                            })
                          }
                          className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm"
                        >
                          <option value="in-process">In-Process</option>
                          <option value="networked">
                            Networked (API/Events)
                          </option>
                        </select>
                      </div>
                    </div>
                  </div>
                ),
              )}
            </div>
          )}
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
            onClick={onNext}
            className="px-8 py-2.5 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm transition-colors"
          >
            Next
          </button>
        </div>
      </footer>
    </div>
  );
}
