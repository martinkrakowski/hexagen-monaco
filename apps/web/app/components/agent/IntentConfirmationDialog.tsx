"use client";

import { useState } from "react";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/Dialog";

interface IntentConfirmationDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onReject: () => void;
  title: string;
  description: string;
  intentDetails: string;
  isLoading?: boolean;
}

export function IntentConfirmationDialog({
  open,
  onClose,
  onConfirm,
  onReject,
  title,
  description,
  intentDetails,
  isLoading = false,
}: IntentConfirmationDialogProps) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-start gap-4">
            <div className="shrink-0">
              <svg
                aria-hidden="true"
                className="h-6 w-6 text-amber-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <div className="flex-1">
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription className="mt-1">
                {description}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="mt-4 p-3 bg-muted rounded-lg">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">
              Proposed Change
            </span>
            <button
              type="button"
              onClick={() => setShowDetails(!showDetails)}
              className="text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            >
              {showDetails ? "Hide Details" : "Show Details"}
            </button>
          </div>
          {showDetails && (
            <pre className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap font-mono">
              {intentDetails}
            </pre>
          )}
        </div>

        <DialogFooter>
          <PrimaryButton
            variant="outline"
            onClick={onReject}
            disabled={isLoading}
          >
            Reject
          </PrimaryButton>
          <PrimaryButton onClick={onConfirm} disabled={isLoading}>
            {isLoading ? "Applying\u2026" : "Apply Change"}
          </PrimaryButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
