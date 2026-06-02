"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Check,
  ExternalLink,
  Loader2,
} from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Input,
} from "@hexagen/ui";

export interface ExportDialogSubmitPayload {
  repoName: string;
  isPrivate: boolean;
  commitMessage: string;
}

/** Which panel the dialog shows; derived from the export state machine. */
export type ExportDialogPhase = "form" | "submitting" | "success" | "error";

interface ExportDialogProps {
  open: boolean;
  phase: ExportDialogPhase;
  onClose: () => void;
  onSubmit: (payload: ExportDialogSubmitPayload) => Promise<void> | void;
  /** Re-run the last publish after an error (no re-typing). */
  onRetry: () => void;
  /** Return to the editable form after an error. */
  onBackToForm: () => void;
  initialRepoName?: string;
  initialIsPrivate?: boolean;
  initialCommitMessage?: string;
  error?: string | null;
  /**
   * Success details. `message` is always present; `owner`/`repo` and `url` are
   * optional so the panel still renders (message + Done) when the structured
   * GitHub link is absent — no blank success body.
   */
  success?: {
    message: string;
    owner?: string;
    repo?: string;
    url?: string;
  } | null;
}

const VALID_REPO_PATTERN = /^[a-zA-Z0-9._-]+$/;

export function ExportDialog({
  open,
  phase,
  onClose,
  onSubmit,
  onRetry,
  onBackToForm,
  initialRepoName = "",
  initialIsPrivate = false,
  initialCommitMessage = "Initial commit",
  error = null,
  success = null,
}: ExportDialogProps) {
  const [repoName, setRepoName] = useState(initialRepoName);
  const [isPrivate, setIsPrivate] = useState(initialIsPrivate);
  const [commitMessage, setCommitMessage] = useState(initialCommitMessage);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the "Copied" reset timer if the dialog unmounts first.
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  // Re-seed the commit message when the dialog (re)opens, so a fresh publish
  // starts from the default rather than a stale prior entry. (repoName/isPrivate
  // intentionally persist across reopen; only the commit message resets here.)
  useEffect(() => {
    if (open) setCommitMessage(initialCommitMessage);
  }, [open, initialCommitMessage]);

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
    await onSubmit({
      repoName: trimmed,
      isPrivate,
      commitMessage: commitMessage.trim(),
    });
  };

  const handleCopy = async () => {
    if (!success?.url) return;
    try {
      await navigator.clipboard.writeText(success.url);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may be unavailable; the Open button still works */
    }
  };

  // The submitting phase is non-dismissible: a mid-push close would leave a
  // half-created repo. Ignore close requests until the request resolves.
  const handleClose = () => {
    if (phase === "submitting") return;
    onClose();
  };

  const title =
    phase === "success"
      ? "Published to GitHub"
      : phase === "error"
        ? "Publish failed"
        : "Push to GitHub";

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      dismissible={phase !== "submitting"}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {phase === "form" ? (
            <DialogDescription>
              Configure the destination repository. A new repository will be
              created in your authenticated GitHub account.
            </DialogDescription>
          ) : null}
        </DialogHeader>

        {phase === "submitting" ? (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center gap-3 py-6 text-sm text-muted-foreground"
          >
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span>
              Creating the repository and pushing files… this can take 30–45
              seconds.
            </span>
          </div>
        ) : null}

        {phase === "success" && success ? (
          <div className="space-y-4 py-2" aria-live="polite">
            <div className="flex items-center gap-2 text-sm text-success">
              <CheckCircle2 className="h-5 w-5" />
              <span>
                {success.owner && success.repo ? (
                  <>
                    Pushed to{" "}
                    <span className="font-medium">
                      {success.owner}/{success.repo}
                    </span>
                  </>
                ) : (
                  success.message
                )}
              </span>
            </div>
            {success.url ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() =>
                    window.open(success.url, "_blank", "noopener,noreferrer")
                  }
                >
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  Open repository
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handleCopy()}
                >
                  {copied ? (
                    <Check className="mr-1.5 h-3.5 w-3.5" />
                  ) : (
                    <Copy className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {copied ? "Copied" : "Copy URL"}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {phase === "error" ? (
          <div
            className="flex items-start gap-2 py-2 text-sm text-destructive"
            role="alert"
          >
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <span>{error ?? "Something went wrong while publishing."}</span>
          </div>
        ) : null}

        {phase === "form" ? (
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
              />
            </div>

            <div className="flex items-center gap-3">
              <input
                id="export-repo-private"
                type="checkbox"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              <label
                htmlFor="export-repo-private"
                className="text-sm font-medium"
              >
                Private repository
              </label>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="export-commit-message"
                className="text-sm font-medium"
              >
                Commit message
              </label>
              <Input
                id="export-commit-message"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder="Initial commit"
              />
            </div>

            {validationError ? (
              <p className="text-xs text-destructive" role="alert">
                {validationError}
              </p>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          {phase === "form" ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void handleSubmit()}
              >
                Push to GitHub
              </Button>
            </>
          ) : null}

          {phase === "submitting" ? (
            <Button type="button" size="sm" disabled>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              Pushing…
            </Button>
          ) : null}

          {phase === "success" ? (
            // autoFocus fires on mount (i.e. when the panel swaps in), moving
            // keyboard focus to the primary action instead of stranding it on
            // the now-unmounted form button.
            <Button type="button" size="sm" onClick={onClose} autoFocus>
              Done
            </Button>
          ) : null}

          {phase === "error" ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onBackToForm}
              >
                Back to form
              </Button>
              <Button type="button" size="sm" onClick={onRetry} autoFocus>
                Retry
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
