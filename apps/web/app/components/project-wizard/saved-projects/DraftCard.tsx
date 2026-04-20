"use client";

import { AlertTriangle, FileEdit, Trash2 } from "lucide-react";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import type { WizardDraft } from "@hexagen/shared";

import { formatDate } from "./format-date";

interface DraftCardProps {
  draft: WizardDraft;
  isConfirmingDiscard: boolean;
  onResume: () => void;
  onRequestDiscard: () => void;
  onConfirmDiscard: () => void;
  onCancelDiscard: () => void;
}

/**
 * Yellow-bordered in-progress draft card shown at the top of the
 * saved-projects list. Has two modes: normal (Resume/Discard buttons)
 * and discard-confirm overlay.
 */
export function DraftCard({
  draft,
  isConfirmingDiscard,
  onResume,
  onRequestDiscard,
  onConfirmDiscard,
  onCancelDiscard,
}: DraftCardProps) {
  return (
    <div className="relative p-4 border border-yellow-500/50 rounded-lg bg-yellow-500/5">
      {isConfirmingDiscard && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/95 backdrop-blur-sm rounded-lg gap-2">
          <AlertTriangle
            aria-hidden="true"
            className="h-4 w-4 text-destructive"
          />
          <span className="text-xs font-medium text-destructive">
            Discard Draft?
          </span>
          <PrimaryButton
            variant="destructive"
            size="sm"
            onClick={onConfirmDiscard}
            className="h-auto px-2 py-1 text-xs"
          >
            Yes
          </PrimaryButton>
          <PrimaryButton
            variant="outline"
            size="sm"
            onClick={onCancelDiscard}
            className="h-auto px-2 py-1 text-xs"
          >
            No
          </PrimaryButton>
        </div>
      )}
      <div className={isConfirmingDiscard ? "invisible" : ""}>
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-500/20 text-yellow-700 dark:text-yellow-300">
            Draft
          </span>
          <span className="text-xs text-muted-foreground">
            Step {(draft.savedAtStep ?? 0) + 1} of 6
          </span>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Last saved: {formatDate(draft.updatedAt)}
        </p>
        <div className="flex items-center gap-2">
          <PrimaryButton
            size="sm"
            onClick={onResume}
            className="h-auto px-3 py-1.5 text-xs"
          >
            <FileEdit aria-hidden="true" className="h-3 w-3 mr-1" />
            Resume
          </PrimaryButton>
          <PrimaryButton
            variant="outline"
            size="sm"
            onClick={onRequestDiscard}
            className="h-auto px-3 py-1.5 text-xs text-destructive hover:text-destructive"
          >
            <Trash2 aria-hidden="true" className="h-3 w-3 mr-1" />
            Discard
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
