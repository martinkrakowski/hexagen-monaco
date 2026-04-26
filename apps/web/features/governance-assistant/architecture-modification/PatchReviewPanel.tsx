"use client";

import { Check, X, Plus, Minus, Pencil, ArrowRight } from "lucide-react";
import type { Patch } from "@hexagen/reconciliation-engine";

interface PatchReviewPanelProps {
  patches: Patch[];
  onAccept: (patch: Patch) => void;
  onReject: (patch: Patch) => void;
}

const PATCH_TYPE_CONFIG: Record<
  Patch["type"],
  { label: string; icon: typeof Plus; colorClass: string }
> = {
  add_node: { label: "Add Node", icon: Plus, colorClass: "text-success" },
  remove_node: {
    label: "Remove Node",
    icon: Minus,
    colorClass: "text-destructive",
  },
  add_edge: { label: "Add Edge", icon: Plus, colorClass: "text-success" },
  remove_edge: {
    label: "Remove Edge",
    icon: Minus,
    colorClass: "text-destructive",
  },
  update_node: {
    label: "Update Node",
    icon: Pencil,
    colorClass: "text-warning",
  },
  update_edge: {
    label: "Update Edge",
    icon: Pencil,
    colorClass: "text-warning",
  },
};

function PatchCard({
  patch,
  onAccept,
  onReject,
}: {
  patch: Patch;
  onAccept: (patch: Patch) => void;
  onReject: (patch: Patch) => void;
}) {
  const config = PATCH_TYPE_CONFIG[patch.type];
  const Icon = config.icon;
  const payloadEntries = Object.entries(patch.payload);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${config.colorClass}`} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
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

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => onAccept(patch)}
            className="h-7 w-7 rounded-md flex items-center justify-center text-success hover:bg-success/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="Accept patch"
          >
            <Check className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onReject(patch)}
            className="h-7 w-7 rounded-md flex items-center justify-center text-destructive hover:bg-destructive/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="Reject patch"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function PatchReviewPanel({
  patches,
  onAccept,
  onReject,
}: PatchReviewPanelProps) {
  if (patches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <ArrowRight className="h-8 w-8 mb-2 opacity-40" />
        <p className="text-sm">No patches to review</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground/60">
          Proposed Patches ({patches.length})
        </span>
      </div>
      {patches.map((patch) => (
        <PatchCard
          key={patch.id}
          patch={patch}
          onAccept={onAccept}
          onReject={onReject}
        />
      ))}
    </div>
  );
}
