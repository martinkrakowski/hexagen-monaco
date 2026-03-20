"use client";

import type { ExternalContext } from "@hexagen/shared";
import { PeerContextItem } from "./PeerContextItem";
import type { ContextUpdateCallback } from "@hexagen/shared";

interface PeerContextListProps {
  contexts: ExternalContext[];
  onAddContext: () => void;
  onUpdateContext: ContextUpdateCallback;
}

export function PeerContextList({
  contexts,
  onAddContext,
  onUpdateContext,
}: PeerContextListProps) {
  const handleRemoveContext = (index: number) => {
    if (contexts.length <= 1 || !contexts[index] || !contexts[index].id) return;

    const updated = contexts.filter((_, i) => i !== index);
    const removedId = contexts[index].id!;

    // Clear the removed context's data first
    onUpdateContext(removedId, {});

    // Update active to first remaining context if any
    if (updated.length > 0 && updated[0].id) {
      onUpdateContext(updated[0].id, {});
    }

    // Note: The actual removal happens at parent level through form.setValue
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Peer Bounded Contexts ({contexts.length})
        </span>
        {contexts.length > 0 && (
          <button
            type="button"
            onClick={onAddContext}
            className="text-xs px-2 py-1 bg-secondary hover:bg-secondary/80 rounded transition-colors"
          >
            + Add Peer
          </button>
        )}
      </div>

      {contexts.map((context, index) => (
        <PeerContextItem
          key={context.id || `peer-${index}`}
          context={context}
          index={index}
          onUpdateContext={onUpdateContext}
          onRemoveContext={() => handleRemoveContext(index)}
        />
      ))}

      {contexts.length === 0 && (
        <div className="border-2 border-dashed rounded-lg p-8 text-center bg-muted/30">
          <p className="text-sm text-muted-foreground mb-4">
            No peer contexts defined.
          </p>
          <button
            type="button"
            onClick={onAddContext}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 transition-colors"
          >
            Add First Peer Context
          </button>
        </div>
      )}
    </div>
  );
}

export default PeerContextList;
