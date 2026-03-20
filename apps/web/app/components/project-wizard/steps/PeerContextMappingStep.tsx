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
}

export function PeerContextMappingStep({
  onNext,
  onBack,
  canProceed,
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
      <div className="space-y-6">
        <div className="border-2 border-dashed rounded-lg p-8 text-center bg-muted/30">
          <p className="text-sm text-muted-foreground mb-2">
            At least 2 bounded contexts required to define peer mappings.
          </p>
          <p className="text-xs text-muted-foreground">
            Add more contexts in the previous step.
          </p>
        </div>

        <div className="flex justify-between pt-6">
          <button
            type="button"
            onClick={onBack}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-muted-foreground/75 transition-colors"
          >
            Back
          </button>
          <button
            type="button"
            onClick={onNext}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 transition-colors"
          >
            Next
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
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
          {peerMappings.map((mapping: PeerContextMapping, index: number) => (
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
                    <option value="acl">Anticorruption Layer (ACL)</option>
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
                    <option value="networked">Networked (API/Events)</option>
                  </select>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-between pt-6">
        <button
          type="button"
          onClick={onBack}
          disabled={!canProceed}
          className="px-4 py-2 text-sm text-muted-foreground hover:text-muted-foreground/75 transition-colors disabled:opacity-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 transition-colors"
        >
          Next
        </button>
      </div>
    </div>
  );
}
