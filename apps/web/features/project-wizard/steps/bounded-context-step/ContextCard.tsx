"use client";

import { AlertTriangle, X } from "lucide-react";
import type { BoundedContext } from "@hexagen/project-configuration";

interface ContextCardProps {
  context: BoundedContext;
  isActive: boolean;
  isDeletable: boolean;
  isConfirmingDelete: boolean;
  onSelect: () => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}

/**
 * Single bounded-context card in the list view. Shows the context
 * avatar + name + item count; reveals an inline delete-confirm
 * overlay when `isConfirmingDelete` is true.
 *
 * `isDeletable` hides the delete affordance entirely when the list
 * has only one context (the wizard requires at least one).
 */
export function ContextCard({
  context,
  isActive,
  isDeletable,
  isConfirmingDelete,
  onSelect,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
}: ContextCardProps) {
  const entityCount =
    (context.coreDomainEntities?.length ?? 0) + (context.useCases?.length ?? 0);

  return (
    <button
      type="button"
      className={`relative w-full text-left p-4 border rounded-lg cursor-pointer transition-colors ${
        isActive
          ? "border-primary bg-primary/10"
          : "border-border bg-background hover:border-input"
      }`}
      onClick={onSelect}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded bg-muted text-muted-foreground">
          <span className="font-bold">
            {context.name?.charAt(0).toUpperCase() || "?"}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-sm text-foreground truncate">
            {context.name || "Unnamed Context"}
          </h3>
          <p className="text-xs text-muted-foreground">{entityCount} items</p>
        </div>
      </div>

      {isDeletable &&
        (isConfirmingDelete ? (
          <div className="absolute inset-0 flex items-center justify-center bg-background/95 backdrop-blur-sm rounded-lg gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <span className="text-xs font-medium text-destructive">
              Delete?
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onConfirmDelete();
              }}
              className="px-2 py-1 text-xs font-medium bg-destructive text-destructive-foreground rounded"
            >
              Yes
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCancelDelete();
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
            aria-label={`Delete ${context.name || "context"}`}
            onClick={(e) => {
              e.stopPropagation();
              onRequestDelete();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                onRequestDelete();
              }
            }}
            className="absolute top-2 right-2 p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer"
          />
        ))}
    </button>
  );
}
