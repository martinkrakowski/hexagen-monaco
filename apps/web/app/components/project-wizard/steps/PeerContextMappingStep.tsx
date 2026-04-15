"use client";

import { useState } from "react";
import { useFormContext } from "react-hook-form";
import { ArrowLeft, ArrowRight, Plus, AlertTriangle, X } from "lucide-react";
import type {
  ProjectConfig,
  PeerContextMapping,
} from "@hexagen/project-configuration";
import { StepHeader } from "./StepHeader";
import { WizardFooter } from "../WizardFooter";

interface PeerContextMappingStepProps {
  onNext: () => void;
  onBack: () => void;
  canProceed: boolean;
  activeMappingId?: string;
  onMappingSelect?: (id: string) => void;
  currentStep?: number;
  totalSteps?: number;
  title?: string;
  description?: string;
}

export function PeerContextMappingStep({
  onNext,
  onBack,
  canProceed,
  activeMappingId,
  onMappingSelect,
  currentStep = 3,
  totalSteps = 6,
  title,
  description,
}: PeerContextMappingStepProps) {
  const { watch, setValue } = useFormContext<ProjectConfig>();
  const boundedContexts = watch("boundedContexts") || [];
  const peerMappings = watch("peerMappings") || [];

  const [view, setView] = useState<"menu" | "form">("menu");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const contextNames = boundedContexts.map(
    (ctx: { id: string; name?: string }) => ({
      id: ctx.id,
      name: ctx.name || "Unnamed Context",
    }),
  );

  const getMappingId = (m: PeerContextMapping): string =>
    `${m.consumerContext}-${m.providerContext}`;

  const getActiveMapping = (): PeerContextMapping | null => {
    if (!activeMappingId) return null;
    return (
      peerMappings.find(
        (m: PeerContextMapping) => getMappingId(m) === activeMappingId,
      ) || null
    );
  };

  const activeMapping = getActiveMapping();

  const handleUpdateMapping = (updates: Partial<PeerContextMapping>) => {
    if (!activeMapping) return;
    const activeIndex = peerMappings.findIndex(
      (m: PeerContextMapping) => getMappingId(m) === activeMappingId,
    );
    if (activeIndex < 0) return;
    const updatedMapping = { ...peerMappings[activeIndex], ...updates };
    const newMappings = peerMappings.map(
      (mapping: PeerContextMapping, i: number) =>
        i === activeIndex ? updatedMapping : mapping,
    );
    setValue("peerMappings", newMappings);
    if (updates.consumerContext || updates.providerContext) {
      onMappingSelect?.(getMappingId(updatedMapping));
    }
  };

  const getContextName = (id: string): string => {
    const ctx = boundedContexts.find((c: { id: string }) => c.id === id);
    return ctx?.name || "Unnamed";
  };

  const handleAddMapping = () => {
    if (boundedContexts.length < 2) return;
    const newMapping: PeerContextMapping = {
      consumerContext: boundedContexts[0]?.id || "",
      providerContext: boundedContexts[1]?.id || "",
      integrationPattern: "open-host",
      communicationBoundary: "in-process",
    };
    setValue("peerMappings", [...peerMappings, newMapping]);
    onMappingSelect?.(getMappingId(newMapping));
    setView("form");
  };

  const handleBack = () => {
    setView("menu");
  };

  const handleDeleteMapping = (mappingId: string) => {
    const indexToDelete = peerMappings.findIndex(
      (m: PeerContextMapping) => getMappingId(m) === mappingId,
    );
    if (indexToDelete >= 0) {
      const newMappings = [...peerMappings];
      newMappings.splice(indexToDelete, 1);
      setValue("peerMappings", newMappings);
      if (activeMappingId === mappingId) {
        if (newMappings.length > 0) {
          const newActiveIndex = Math.min(
            indexToDelete,
            newMappings.length - 1,
          );
          onMappingSelect?.(getMappingId(newMappings[newActiveIndex]));
          setView("menu");
        } else {
          onMappingSelect?.("");
        }
      }
    }
    setConfirmDeleteId(null);
  };

  const renderMenuView = () => {
    if (boundedContexts.length < 2) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="border-2 border-dashed rounded-lg p-8 text-center bg-muted/30 max-w-md mx-auto">
            <p className="text-sm text-muted-foreground mb-2">
              At least 2 bounded contexts required to define peer mappings.
            </p>
            <p className="text-xs text-muted-foreground">
              Add more contexts in the previous step.
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <div className="space-y-2">
          {peerMappings.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-muted-foreground mb-4">
                No peer mappings yet.
              </p>
              <p className="text-xs text-muted-foreground">
                Add a mapping to connect your bounded contexts.
              </p>
            </div>
          ) : (
            peerMappings.map((mapping: PeerContextMapping) => {
              const mappingId = getMappingId(mapping);
              const consumerName = getContextName(mapping.consumerContext);
              const providerName = getContextName(mapping.providerContext);

              return (
                <div
                  key={mappingId}
                  className={`relative w-full text-left p-4 border border-border rounded-lg cursor-pointer transition-colors ${
                    activeMappingId === mappingId
                      ? "border-primary bg-primary/10"
                      : "border-border bg-background hover:border-input"
                  }`}
                  onClick={() => {
                    onMappingSelect?.(mappingId);
                    setView("form");
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded bg-muted text-muted-foreground">
                      <ArrowRight className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-sm text-foreground truncate">
                        {consumerName} → {providerName}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {mapping.communicationBoundary === "in-process"
                          ? "In-Process"
                          : "Networked"}{" "}
                        ·{" "}
                        {mapping.integrationPattern === "open-host"
                          ? "OHS"
                          : "ACL"}
                      </p>
                    </div>
                  </div>
                  {peerMappings.length > 0 &&
                    (confirmDeleteId === mappingId ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-background/95 backdrop-blur-sm rounded-lg gap-2">
                        <AlertTriangle className="h-4 w-4 text-destructive" />
                        <span className="text-xs font-medium text-destructive">
                          Delete?
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteMapping(mappingId);
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
                          setConfirmDeleteId(mappingId);
                        }}
                        className="absolute top-2 right-2 p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                      />
                    ))}
                </div>
              );
            })
          )}
        </div>
        <button
          type="button"
          onClick={handleAddMapping}
          disabled={boundedContexts.length < 2}
          className="w-full mt-4 py-3 px-4 border border-dashed border-input rounded-lg text-sm text-muted-foreground hover:border-primary hover:text-primary hover:bg-primary/5 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="h-4 w-4" />
          Add Mapping
        </button>
      </div>
    );
  };

  const renderFormView = () => {
    if (!activeMapping) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">
            Select a mapping to edit
          </p>
        </div>
      );
    }

    return (
      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        <button
          type="button"
          onClick={handleBack}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to mapping list
        </button>

        <div className="space-y-6">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">
                Consumer Context (Source)
              </label>
              <select
                value={activeMapping.consumerContext || ""}
                onChange={(e) =>
                  handleUpdateMapping({
                    consumerContext: e.target.value,
                  })
                }
                className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
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
                value={activeMapping.providerContext || ""}
                onChange={(e) =>
                  handleUpdateMapping({
                    providerContext: e.target.value,
                  })
                }
                className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
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

          <div className="space-y-6">
            <div>
              <div className="pb-2 mb-4">
                <h3 className="text-sm font-bold text-foreground uppercase tracking-widest">
                  Integration Details
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  {getContextName(activeMapping.consumerContext)} →{" "}
                  {getContextName(activeMapping.providerContext)}
                </p>
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
              <div className="pb-2 mb-4">
                <h3 className="text-sm font-bold text-foreground uppercase tracking-widest">
                  Communication
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  How contexts communicate
                </p>
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
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-card">
      <StepHeader
        currentStep={currentStep}
        totalSteps={totalSteps}
        title={title || "Peer Context Mappings"}
        description={description || "Define how contexts interact."}
      />

      {view === "menu" ? renderMenuView() : renderFormView()}

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
