"use client";

import {
  Check,
  X,
  Plus,
  Minus,
  Pencil,
  ArrowRight,
  Loader2,
} from "lucide-react";
import type { Patch } from "@hexagen/reconciliation-engine";
import { StepHeader } from "./StepHeader";
import { WizardFooter } from "../WizardFooter";

interface ReviewStepProps {
  transactionId: string;
  patches: Patch[];
  onAccept: () => void;
  onReject: () => void;
  onBack: () => void;
  isAccepting?: boolean;
  isRejecting?: boolean;
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

function PatchCard({ patch }: { patch: Patch }) {
  const config = PATCH_TYPE_CONFIG[patch.type];
  const Icon = config.icon;
  const payloadEntries = Object.entries(patch.payload);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
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
    </div>
  );
}

function PatchReviewPanelInternal({
  patches,
  onAcceptAll,
  onRejectAll,
}: {
  patches: Patch[];
  onAcceptAll: () => void;
  onRejectAll: () => void;
}) {
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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onAcceptAll}
            className="h-7 px-3 rounded-md flex items-center gap-1.5 text-xs font-medium text-success hover:bg-success/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Check className="h-3.5 w-3.5" />
            Accept All
          </button>
          <button
            type="button"
            onClick={onRejectAll}
            className="h-7 px-3 rounded-md flex items-center gap-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-3.5 w-3.5" />
            Reject All
          </button>
        </div>
      </div>
      {patches.map((patch) => (
        <PatchCard key={patch.id} patch={patch} />
      ))}
    </div>
  );
}

export function ReviewStep({
  patches,
  onAccept,
  onReject,
  onBack,
  isAccepting = false,
  isRejecting = false,
}: ReviewStepProps) {
  const isLoading = isAccepting || isRejecting;

  return (
    <div className="flex flex-col h-full bg-card">
      <StepHeader
        currentStep={6}
        totalSteps={6}
        title="Review Architecture Changes"
        description="Review the proposed changes before applying them to your project."
      />

      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-4">
        {isLoading && (
          <div className="flex items-center justify-center py-4 mb-4">
            <Loader2 className="h-5 w-5 animate-spin text-primary mr-2" />
            <span className="text-sm text-muted-foreground">
              {isAccepting ? "Accepting changes..." : "Rejecting changes..."}
            </span>
          </div>
        )}
        <PatchReviewPanelInternal
          patches={patches}
          onAcceptAll={onAccept}
          onRejectAll={onReject}
        />
      </div>

      <WizardFooter onBack={onBack} canProceed={!isLoading} showNext={false} />
    </div>
  );
}
