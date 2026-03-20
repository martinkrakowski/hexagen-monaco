"use client";

import { useFormContext } from "react-hook-form";
import type {
  ProjectConfig,
  BoundedContext,
  PeerContextMapping,
} from "@hexagen/project-configuration";
import { projectAddons } from "../config";

interface SummaryStepProps {
  onBack: () => void;
  onGenerate: () => void;
  canProceed: boolean;
  isGenerating: boolean;
}

export function SummaryStep({
  onBack,
  onGenerate,
  canProceed,
  isGenerating,
}: SummaryStepProps) {
  const { watch } = useFormContext<ProjectConfig>();

  const governance = watch("governance");
  const boundedContexts = watch("boundedContexts") || [];
  const peerMappings = watch("peerMappings") || [];

  return (
    <div className="space-y-6">
      <div className="mb-4">
        <h2 className="text-xl font-bold">Review & Generate</h2>
        <p className="text-sm text-muted-foreground">
          Review your configuration before generating the project
        </p>
      </div>

      <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-2">
        {/* Workspace Governance Summary */}
        <div className="border rounded-lg p-4 bg-card">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
            Workspace Governance
          </h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-muted-foreground">Name:</span>{" "}
              <span className="font-medium">
                {governance?.workspaceName || "Not set"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Package Manager:</span>{" "}
              <span className="font-medium">
                {governance?.packageManager || "yarn"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Topology:</span>{" "}
              <span className="font-medium">
                {governance?.topologyStrictness || "flexible"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Namespace:</span>{" "}
              <span className="font-medium">
                {governance?.namespacePrefix || "@hexagen"}
              </span>
            </div>
          </div>
        </div>

        {/* Bounded Contexts Summary */}
        <div className="border rounded-lg p-4 bg-card">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
            Bounded Contexts ({boundedContexts.length})
          </h3>
          <div className="space-y-2">
            {boundedContexts.map((ctx: BoundedContext, i: number) => (
              <div key={ctx.id} className="flex items-center gap-2 text-sm">
                <span className="text-xs font-mono text-muted-foreground">
                  {i + 1}.
                </span>
                <span className="font-medium">{ctx.name || "Unnamed"}</span>
                <span className="text-muted-foreground text-xs">
                  ({ctx.infrastructureTarget || "nestjs"})
                </span>
                {ctx.portConfiguration?.inboundPorts && (
                  <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                    {ctx.portConfiguration.inboundPorts.length} in
                  </span>
                )}
                {ctx.portConfiguration?.outboundPorts && (
                  <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                    {ctx.portConfiguration.outboundPorts.length} out
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Peer Mappings Summary */}
        {peerMappings.length > 0 && (
          <div className="border rounded-lg p-4 bg-card">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
              Peer Mappings ({peerMappings.length})
            </h3>
            <div className="space-y-2">
              {peerMappings.map((mapping: PeerContextMapping, i: number) => {
                const consumer = boundedContexts.find(
                  (c) => c.id === mapping.consumerContext,
                );
                const provider = boundedContexts.find(
                  (c) => c.id === mapping.providerContext,
                );
                return (
                  <div key={i} className="text-sm">
                    <span className="font-medium">
                      {consumer?.name || "Unknown"}
                    </span>{" "}
                    <span className="text-muted-foreground">→</span>{" "}
                    <span className="font-medium">
                      {provider?.name || "Unknown"}
                    </span>
                    <span className="text-xs text-muted-foreground ml-2">
                      ({mapping.integrationPattern},{" "}
                      {mapping.communicationBoundary})
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Project Add-ons Summary */}
        <div className="border rounded-lg p-4 bg-card">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
            Project Add-ons
          </h3>
          <div className="space-y-2">
            {projectAddons.map((addon) => (
              <div key={addon.id} className="flex items-center gap-3">
                <input
                  type="checkbox"
                  name={addon.id}
                  checked={watch(addon.id as keyof ProjectConfig) as boolean}
                  readOnly
                  className="h-4 w-4 accent-primary"
                />
                <label className="text-sm">{addon.title}</label>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Generate Button */}
      <div className="border-t border-sidebar-border pt-6 space-y-4">
        <div className="flex justify-between">
          <button
            type="button"
            onClick={onBack}
            disabled={isGenerating}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-muted-foreground/75 transition-colors disabled:opacity-50"
          >
            Back
          </button>
          <button
            type="button"
            onClick={onGenerate}
            disabled={
              isGenerating || boundedContexts.length === 0 || !canProceed
            }
            className="px-6 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 font-medium"
          >
            {isGenerating ? "Generating..." : "Generate Project"}
          </button>
        </div>
      </div>
    </div>
  );
}
