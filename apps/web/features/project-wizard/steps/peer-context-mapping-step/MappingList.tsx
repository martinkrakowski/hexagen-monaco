"use client";

import { Plus } from "lucide-react";
import type {
  BoundedContext,
  PeerContextMapping,
} from "@hexagen/project-configuration";

import { MappingCard } from "./MappingCard";
import { getMappingId, getContextName } from "./mapping-identity";

interface MappingListProps {
  mappings: PeerContextMapping[];
  boundedContexts: BoundedContext[];
  activeMappingId?: string;
  confirmDeleteId: string | null;
  onSelectMapping: (id: string) => void;
  onAddMapping: () => void;
  onRequestDelete: (id: string) => void;
  onConfirmDelete: (id: string) => void;
  onCancelDelete: () => void;
  readOnly?: boolean;
}

/**
 * Menu view for the peer-mapping wizard step. Renders one of three
 * states:
 *   1. Fewer than 2 bounded contexts — mappings not yet possible;
 *      tells the user to add more contexts in the previous step.
 *   2. No mappings yet — prompts user to add one.
 *   3. List of MappingCards + Add button.
 */
export function MappingList({
  mappings,
  boundedContexts,
  activeMappingId,
  confirmDeleteId,
  onSelectMapping,
  onAddMapping,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  readOnly,
}: MappingListProps) {
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
        {mappings.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-sm text-muted-foreground mb-4">
              No peer mappings yet.
            </p>
            <p className="text-xs text-muted-foreground">
              Add a mapping to connect your bounded contexts.
            </p>
          </div>
        ) : (
          mappings.map((mapping) => {
            const mappingId = getMappingId(mapping);
            return (
              <MappingCard
                key={mappingId}
                mapping={mapping}
                mappingId={mappingId}
                consumerName={getContextName(
                  mapping.consumerContext,
                  boundedContexts,
                )}
                providerName={getContextName(
                  mapping.providerContext,
                  boundedContexts,
                )}
                isActive={activeMappingId === mappingId}
                isConfirmingDelete={confirmDeleteId === mappingId}
                onSelect={() => onSelectMapping(mappingId)}
                onRequestDelete={() => onRequestDelete(mappingId)}
                onConfirmDelete={() => onConfirmDelete(mappingId)}
                onCancelDelete={onCancelDelete}
                readOnly={readOnly}
              />
            );
          })
        )}
      </div>

      {!readOnly && (
        <button
          type="button"
          onClick={onAddMapping}
          disabled={boundedContexts.length < 2}
          className="w-full mt-4 py-3 px-4 border border-dashed border-input rounded-lg text-sm text-muted-foreground hover:border-primary hover:text-primary hover:bg-primary/5 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="h-4 w-4" />
          Add Mapping
        </button>
      )}
    </div>
  );
}
