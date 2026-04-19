"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/Dialog";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { Input } from "@/components/ui/Input";

export interface ExportDialogSubmitPayload {
  repoName: string;
  isPrivate: boolean;
}

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: ExportDialogSubmitPayload) => Promise<void> | void;
  isSubmitting?: boolean;
  initialRepoName?: string;
  initialIsPrivate?: boolean;
  error?: string | null;
}

const VALID_REPO_PATTERN = /^[a-zA-Z0-9._-]+$/;

export function ExportDialog({
  open,
  onClose,
  onSubmit,
  isSubmitting = false,
  initialRepoName = "",
  initialIsPrivate = false,
  error = null,
}: ExportDialogProps) {
  const [repoName, setRepoName] = useState(initialRepoName);
  const [isPrivate, setIsPrivate] = useState(initialIsPrivate);
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const trimmed = repoName.trim();
    if (!trimmed) {
      setValidationError("Repository name is required.");
      return;
    }
    if (!VALID_REPO_PATTERN.test(trimmed)) {
      setValidationError(
        "Repository name may only contain letters, numbers, dots, dashes, and underscores.",
      );
      return;
    }
    setValidationError(null);
    await onSubmit({ repoName: trimmed, isPrivate });
  };

  const displayedError = validationError ?? error;

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Push to GitHub</DialogTitle>
          <DialogDescription>
            Configure the destination repository. A new repository will be
            created in your authenticated GitHub account.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="export-repo-name" className="text-sm font-medium">
              Repository Name
            </label>
            <Input
              id="export-repo-name"
              value={repoName}
              onChange={(e) => {
                setRepoName(e.target.value);
                setValidationError(null);
              }}
              placeholder="my-hexagen-project"
              disabled={isSubmitting}
            />
          </div>

          <div className="flex items-center gap-3">
            <input
              id="export-repo-private"
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              disabled={isSubmitting}
              className="h-4 w-4 accent-primary"
            />
            <label htmlFor="export-repo-private" className="text-sm font-medium">
              Private repository
            </label>
          </div>

          {displayedError ? (
            <p className="text-xs text-destructive" role="alert">
              {displayedError}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <PrimaryButton
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </PrimaryButton>
          <PrimaryButton
            type="button"
            size="sm"
            onClick={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? "Pushing…" : "Push to GitHub"}
          </PrimaryButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
