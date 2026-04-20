"use client";

import { ArrowRight, AlertTriangle, X } from "lucide-react";
import type { PeerContextMapping } from "@hexagen/project-configuration";

interface MappingCardProps {
  mapping: PeerContextMapping;
  mappingId: string;
  consumerName: string;
  providerName: string;
  isActive: boolean;
  isConfirmingDelete: boolean;
  onSelect: () => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}

/**
 * Single peer-mapping card in the list view. Shows the consumer →
 * provider flow, the boundary type (in-process / networked), and the
 * integration pattern acronym (OHS / ACL). Reveals an inline
 * delete-confirm overlay when `isConfirmingDelete` is true.
 */
export function MappingCard({
  mapping,
  mappingId,
  consumerName,
  providerName,
  isActive,
  isConfirmingDelete,
  onSelect,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
}: MappingCardProps) {
  const boundaryLabel =
    mapping.communicationBoundary === "in-process" ? "In-Process" : "Networked";
  const patternLabel =
    mapping.integrationPattern === "open-host" ? "OHS" : "ACL";

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
          <ArrowRight className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-sm text-foreground truncate">
            {consumerName} → {providerName}
          </h3>
          <p className="text-xs text-muted-foreground">
            {boundaryLabel} · {patternLabel}
          </p>
        </div>
      </div>

      {isConfirmingDelete ? (
        <div className="absolute inset-0 flex items-center justify-center bg-background/95 backdrop-blur-sm rounded-lg gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <span className="text-xs font-medium text-destructive">Delete?</span>
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
          aria-label={`Delete mapping ${mappingId}`}
          onClick={(e) => {
            e.stopPropagation();
            onRequestDelete();
          }}
          className="absolute top-2 right-2 p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer"
        />
      )}
    </button>
  );
}
