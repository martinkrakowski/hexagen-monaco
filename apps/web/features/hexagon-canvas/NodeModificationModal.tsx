"use client";

import { useEffect } from "react";
import { X, Check, XCircle } from "lucide-react";
import type { Patch } from "@hexagen/reconciliation-engine";

interface NodeModificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  patches: Patch[];
  isAccepting: boolean;
  isRejecting: boolean;
  onAccept: () => void;
  onReject: (reason?: string) => void;
}

function PatchCard({ patch }: { patch: Patch }) {
  const typeConfig: Record<
    Patch["type"],
    { label: string; colorClass: string }
  > = {
    add_node: { label: "Add Node", colorClass: "text-success" },
    remove_node: { label: "Remove Node", colorClass: "text-destructive" },
    add_edge: { label: "Add Edge", colorClass: "text-success" },
    remove_edge: { label: "Remove Edge", colorClass: "text-destructive" },
    update_node: { label: "Update Node", colorClass: "text-warning" },
    update_edge: { label: "Update Edge", colorClass: "text-warning" },
  };

  const config = typeConfig[patch.type];
  const payloadEntries = Object.entries(patch.payload);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start gap-2.5 min-w-0">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`text-xs font-medium uppercase tracking-wider ${config.colorClass}`}
            >
              {config.label}
            </span>
          </div>
          <p className="text-sm font-medium text-foreground font-mono truncate">
            {patch.targetId}
          </p>
          {payloadEntries.length > 0 && (
            <div className="mt-2 space-y-1">
              {payloadEntries.map(([key, value]) => (
                <div key={key} className="flex items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground font-mono">
                    {key}:
                  </span>
                  <span className="text-foreground font-mono truncate">
                    {typeof value === "object"
                      ? JSON.stringify(value)
                      : String(value)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function NodeModificationModal({
  isOpen,
  onClose,
  patches,
  isAccepting,
  isRejecting,
  onAccept,
  onReject,
}: NodeModificationModalProps) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isAccepting && !isRejecting) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [isOpen, onClose, isAccepting, isRejecting]);

  if (!isOpen) return null;

  const isLoading = isAccepting || isRejecting;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-overlay/80 backdrop-blur-sm"
        onClick={!isLoading ? onClose : undefined}
      />

      <div className="relative z-10 w-full max-w-lg mx-4 bg-card rounded-lg border border-border shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">
            Review Canvas Changes
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="h-8 w-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 max-h-96 overflow-y-auto custom-scrollbar">
          {patches.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <p className="text-sm">No changes to review</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground/60">
                  Proposed Changes ({patches.length})
                </span>
              </div>
              {patches.map((patch) => (
                <PatchCard key={patch.id} patch={patch} />
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-border bg-muted/30">
          <button
            type="button"
            onClick={() => onReject()}
            disabled={isLoading}
            className="h-9 px-4 rounded-md flex items-center gap-2 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRejecting ? (
              <span className="h-4 w-4 rounded-full border-2 border-destructive/30 border-t-destructive animate-spin" />
            ) : (
              <XCircle size={16} />
            )}
            Reject Changes
          </button>
          <button
            type="button"
            onClick={onAccept}
            disabled={isLoading}
            className="h-9 px-4 rounded-md flex items-center gap-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isAccepting ? (
              <span className="h-4 w-4 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground animate-spin" />
            ) : (
              <Check size={16} />
            )}
            Accept Changes
          </button>
        </div>
      </div>
    </div>
  );
}
