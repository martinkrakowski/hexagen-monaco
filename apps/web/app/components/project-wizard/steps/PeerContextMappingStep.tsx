"use client";

import { useState, useEffect } from "react";
import { useFormContext } from "react-hook-form";
import { ArrowRight } from "lucide-react";
import { PeerMappingSidebar } from "./PeerMappingSidebar";
import type {
  ProjectConfig,
  PeerContextMapping,
} from "@hexagen/project-configuration";

interface PeerContextMappingStepProps {
  onNext: () => void;
  onBack: () => void;
  canProceed: boolean;
  activeMappingId?: string;
  onMappingSelect?: (mappingId: string) => void;
  currentStep?: number;
  totalSteps?: number;
}

export function PeerContextMappingStep({
  onNext,
  onBack,
  canProceed,
  activeMappingId,
  onMappingSelect,
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
      <div className="flex-shrink-0 border-b border-slate-100 p-6 bg-slate-50/50">
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
        <p className="text-muted-foreground text-sm">
          Define how contexts interact with each other.
        </p>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="w-64 shrink-0">
          <PeerMappingSidebar
            activeMappingId={activeMappingId || ""}
            onMappingSelect={onMappingSelect || (() => {})}
          />
        </div>

        <div className="flex-1 overflow-hidden">
          {!activeMapping ? (
            <div className="flex flex-col h-full items-center justify-center">
              <div className="text-center">
                <ArrowRight className="h-8 w-8 mx-auto mb-3 text-slate-300" />
                <p className="text-sm text-slate-500">
                  Select a mapping from the sidebar to edit
                </p>
              </div>
            </div>
          ) : (
            <div key={activeMappingId} className="flex flex-col h-full">
              <div className="flex-1 overflow-y-auto p-6">
                <div className="max-w-2xl">
                  <div className="mb-6">
                    <h3 className="text-lg font-semibold text-slate-800 mb-1">
                      Mapping: {getContextName(activeMapping.consumerContext)} →{" "}
                      {getContextName(activeMapping.providerContext)}
                    </h3>
                    <p className="text-xs text-slate-400">
                      Configure the relationship between these contexts
                    </p>
                  </div>

                  <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                          Consumer Context (Source)
                        </label>
                        <select
                          value={activeMapping.consumerContext}
                          onChange={(e) =>
                            handleUpdateMapping({
                              consumerContext: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
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
                        <p className="text-[10px] text-slate-400">
                          The context making the request
                        </p>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                          Provider Context (Target)
                        </label>
                        <select
                          value={activeMapping.providerContext}
                          onChange={(e) =>
                            handleUpdateMapping({
                              providerContext: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
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
                        <p className="text-[10px] text-slate-400">
                          The context receiving the request
                        </p>
                      </div>
                    </div>

                    <div className="border-t border-slate-200 pt-6">
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-4">
                        Integration Details
                      </h4>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">
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
                            className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                          >
                            <option value="open-host">
                              Open Host Service (OHS)
                            </option>
                            <option value="acl">
                              Anticorruption Layer (ACL)
                            </option>
                          </select>
                          <p className="text-[10px] text-slate-400">
                            How the contexts expose their interfaces
                          </p>
                        </div>

                        <div className="space-y-2">
                          <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">
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
                            className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                          >
                            <option value="in-process">In-Process</option>
                            <option value="networked">Networked</option>
                          </select>
                          <p className="text-[10px] text-slate-400">
                            Whether calls are synchronous or via events
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
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
          )}
        </div>
      </div>
    </div>
  );
}
