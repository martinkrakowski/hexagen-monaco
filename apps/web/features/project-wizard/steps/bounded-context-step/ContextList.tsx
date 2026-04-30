"use client";

import { Plus } from "lucide-react";
import type { BoundedContext } from "@hexagen/project-configuration";

import { ContextCard } from "./ContextCard";

interface ContextListProps {
  contexts: BoundedContext[];
  activeContextId?: string;
  confirmDeleteId: string | null;
  onSelectContext: (id: string) => void;
  onAddContext: () => void;
  onRequestDelete: (id: string) => void;
  onConfirmDelete: (id: string) => void;
  onCancelDelete: () => void;
  readOnly?: boolean;
}

/**
 * Menu view for the bounded-context wizard step. Shows an empty
 * state, a list of ContextCards, and an "Add Context" button at
 * the bottom.
 */
export function ContextList({
  contexts,
  activeContextId,
  confirmDeleteId,
  onSelectContext,
  onAddContext,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  readOnly,
}: ContextListProps) {
  const isDeletable = !readOnly && contexts.length > 1;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4">
      <div className="space-y-2">
        {contexts.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-sm text-muted-foreground mb-4">
              No bounded contexts yet.
            </p>
            <p className="text-xs text-muted-foreground">
              {readOnly
                ? "No bounded contexts defined in the manifest."
                : "Add a context to get started."}
            </p>
          </div>
        ) : (
          contexts.map((context) => (
            <ContextCard
              key={context.id}
              context={context}
              isActive={activeContextId === context.id}
              isDeletable={isDeletable}
              isConfirmingDelete={confirmDeleteId === context.id}
              onSelect={() => onSelectContext(context.id)}
              onRequestDelete={() => onRequestDelete(context.id)}
              onConfirmDelete={() => onConfirmDelete(context.id)}
              onCancelDelete={onCancelDelete}
            />
          ))
        )}
      </div>

      {!readOnly && (
        <button
          type="button"
          onClick={onAddContext}
          className="w-full mt-4 py-3 px-4 border border-dashed border-input rounded-lg text-sm text-muted-foreground hover:border-primary hover:text-primary hover:bg-primary/5 transition-colors flex items-center justify-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Add Context
        </button>
      )}
    </div>
  );
}
