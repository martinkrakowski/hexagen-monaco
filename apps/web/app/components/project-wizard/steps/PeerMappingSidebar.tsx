"use client";

import { useState } from "react";
import { useFormContext } from "react-hook-form";
import { AlertTriangle, ArrowRight, Plus, X } from "lucide-react";
import type {
  ProjectConfig,
  PeerContextMapping,
} from "@hexagen/project-configuration";

interface PeerMappingSidebarProps {
  activeMappingId: string;
  onMappingSelect: (mappingId: string) => void;
}

const INTEGRATION_LABELS: Record<string, string> = {
  "open-host": "OHS",
  acl: "ACL",
};

const BOUNDARY_LABELS: Record<string, string> = {
  "in-process": "In-Process",
  networked: "Networked",
};

export function PeerMappingSidebar({
  activeMappingId,
  onMappingSelect,
}: PeerMappingSidebarProps) {
  const { watch, setValue } = useFormContext<ProjectConfig>();
  const boundedContexts = watch("boundedContexts") || [];
  const peerMappings = watch("peerMappings") || [];
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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
    onMappingSelect(
      newMapping.consumerContext + "-" + newMapping.providerContext,
    );
  };

  const handleDeleteMapping = (mappingId: string) => {
    const indexToDelete = peerMappings.findIndex(
      (m: PeerContextMapping) =>
        `${m.consumerContext}-${m.providerContext}` === mappingId,
    );
    if (indexToDelete >= 0) {
      const newMappings = [...peerMappings];
      newMappings.splice(indexToDelete, 1);
      setValue("peerMappings", newMappings);
      if (activeMappingId === mappingId) {
        const nextMapping = newMappings[0];
        onMappingSelect(
          nextMapping
            ? `${nextMapping.consumerContext}-${nextMapping.providerContext}`
            : "",
        );
      }
    }
    setConfirmDeleteId(null);
  };

  return (
    <div className="flex flex-col h-full bg-card border-r border-border">
      <div className="p-4 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">Peer Mappings</h2>
        <p className="text-xs text-muted-foreground mt-1">
          {peerMappings.length} mapping{peerMappings.length !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {peerMappings.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            No mappings defined
          </div>
        ) : (
          peerMappings.map((mapping: PeerContextMapping) => {
            const mappingId = `${mapping.consumerContext}-${mapping.providerContext}`;
            const consumerName = getContextName(mapping.consumerContext);
            const providerName = getContextName(mapping.providerContext);

            return (
              <button
                key={mappingId}
                type="button"
                onClick={() => onMappingSelect(mappingId)}
                className={`relative w-full text-left p-3 border border-border rounded-lg cursor-pointer transition-[border-color,background-color] ${
                  activeMappingId === mappingId
                    ? "border-primary bg-primary/10"
                    : "border-border bg-background hover:border-input"
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded bg-muted text-muted-foreground">
                    <ArrowRight aria-hidden="true" className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-sm text-foreground truncate">
                      {consumerName}
                    </h3>
                    <p className="text-[10px] text-muted-foreground">
                      {BOUNDARY_LABELS[mapping.communicationBoundary] ||
                        mapping.communicationBoundary}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1 pl-10">
                  <span className="truncate">{providerName}</span>
                  <span className="shrink-0 text-[8px] font-mono bg-muted px-1 rounded">
                    {INTEGRATION_LABELS[mapping.integrationPattern] ||
                      mapping.integrationPattern}
                  </span>
                </div>

                {peerMappings.length > 0 &&
                  peerMappings[0] !== mapping &&
                  (confirmDeleteId === mappingId ? (
                    <div
                      className="absolute inset-0 flex items-center justify-center bg-background/95 backdrop-blur-sm rounded-lg gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <AlertTriangle
                        aria-hidden="true"
                        className="h-4 w-4 text-destructive"
                      />
                      <span className="text-xs font-medium text-destructive">
                        Delete?
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteMapping(mappingId);
                        }}
                        className="px-2 py-1 text-xs font-medium text-destructive-foreground bg-destructive rounded hover:bg-destructive/90"
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(null);
                        }}
                        className="px-2 py-1 text-xs font-medium text-foreground bg-muted rounded hover:bg-muted"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteId(mappingId);
                      }}
                      className="absolute top-1 right-1 p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      aria-label="Delete mapping"
                    >
                      <X aria-hidden="true" className="h-3 w-3" />
                    </button>
                  ))}
              </button>
            );
          })
        )}
      </div>

      <div className="p-3 border-t border-border">
        <button
          type="button"
          onClick={handleAddMapping}
          disabled={boundedContexts.length < 2}
          className="w-full py-2 px-3 border border-dashed border-input rounded-lg text-sm text-muted-foreground hover:border-primary hover:text-primary hover:bg-primary/5 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Add Mapping
        </button>
      </div>
    </div>
  );
}
