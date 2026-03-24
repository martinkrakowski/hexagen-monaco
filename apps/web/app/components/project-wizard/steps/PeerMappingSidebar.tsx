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
      (m: PeerContextMapping, i: number) =>
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

  const handleMappingClick = (mappingId: string) => {
    onMappingSelect(mappingId);
  };

  return (
    <div className="flex flex-col h-full bg-white border-r border-slate-200">
      <div className="p-4 border-b border-slate-100">
        <h2 className="text-sm font-semibold text-slate-700">Peer Mappings</h2>
        <p className="text-xs text-slate-400 mt-1">
          {peerMappings.length} mapping{peerMappings.length !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {peerMappings.length === 0 ? (
          <div className="p-4 text-center text-sm text-slate-400">
            No mappings defined
          </div>
        ) : (
          peerMappings.map((mapping: PeerContextMapping, index: number) => {
            const mappingId = `${mapping.consumerContext}-${mapping.providerContext}`;
            const consumerName = getContextName(mapping.consumerContext);
            const providerName = getContextName(mapping.providerContext);

            return (
              <div
                key={mappingId}
                onClick={() => handleMappingClick(mappingId)}
                className={`relative p-3 border rounded-lg cursor-pointer transition-all ${
                  activeMappingId === mappingId
                    ? "border-blue-500 bg-blue-50"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded bg-slate-100 text-slate-500">
                    <ArrowRight className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-sm text-slate-800 truncate">
                      {consumerName}
                    </h3>
                    <p className="text-[10px] text-slate-400">
                      {BOUNDARY_LABELS[mapping.communicationBoundary] ||
                        mapping.communicationBoundary}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1 text-xs text-slate-500 mb-1 pl-10">
                  <span className="truncate">{providerName}</span>
                  <span className="shrink-0 text-[8px] font-mono bg-slate-200 px-1 rounded">
                    {INTEGRATION_LABELS[mapping.integrationPattern] ||
                      mapping.integrationPattern}
                  </span>
                </div>

                {peerMappings.length > 0 &&
                  peerMappings[0] !== mapping &&
                  (confirmDeleteId === mappingId ? (
                    <div
                      className="absolute inset-0 flex items-center justify-center bg-white/95 backdrop-blur-sm rounded-lg gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
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
                        className="px-2 py-1 text-xs font-medium text-white bg-destructive rounded hover:bg-destructive/90"
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(null);
                        }}
                        className="px-2 py-1 text-xs font-medium text-slate-600 bg-slate-100 rounded hover:bg-slate-200"
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
                      className="absolute top-1 right-1 p-1 rounded text-slate-400 hover:text-destructive hover:bg-destructive/10 transition-colors"
                      aria-label="Delete mapping"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  ))}
              </div>
            );
          })
        )}
      </div>

      <div className="p-3 border-t border-slate-100">
        <button
          type="button"
          onClick={handleAddMapping}
          disabled={boundedContexts.length < 2}
          className="w-full py-2 px-3 border border-dashed border-slate-300 rounded-lg text-sm text-slate-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/50 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="h-4 w-4" />
          Add Mapping
        </button>
      </div>
    </div>
  );
}
