"use client";

import { useEffect, useState } from "react";
import { RotateCw, Upload, FolderPlus } from "lucide-react";
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
import type { PublishMode } from "@hexagen/shared";

import {
  PUBLISH_MODE_MESSAGES,
  resolveInitialPublishMode,
} from "@/contexts/publish-settings";
// The submit contract is owned by the publish context, not by this dialog —
// see the module comment in `app/contexts/export-payloads.ts` (ADR-0055).
import type { PublishSettingsSubmitPayload } from "@/contexts/export-payloads";

interface PublishSettingsDialogProps {
  open: boolean;
  repo: { owner: string; repo: string };
  defaultMode: PublishMode;
  defaultMessage: string;
  /** Current remembered state, so the checkbox reflects storage (re-open via gear). */
  defaultRemember: boolean;
  /** Whether there are editor edits available — gates the "editor" option. */
  hasEditorEdits: boolean;
  onClose: () => void;
  onSubmit: (payload: PublishSettingsSubmitPayload) => void;
}

interface ModeOption {
  mode: PublishMode;
  label: string;
  description: string;
  Icon: typeof RotateCw;
}

const OPTIONS: ModeOption[] = [
  {
    mode: "scaffold",
    label: "Re-publish scaffold",
    description: "Push the freshly generated scaffold to the connected repo.",
    Icon: RotateCw,
  },
  {
    mode: "editor",
    label: "Push editor edits",
    description: "Commit your latest editor (and AI) changes to the repo.",
    Icon: Upload,
  },
  {
    mode: "new-repo",
    label: "Publish to a new repo",
    description: "Create a separate repository instead of updating this one.",
    Icon: FolderPlus,
  },
];

/**
 * Settings/preferences modal shown when re-publishing an already-linked
 * project. Lets the operator choose what the "Publish to GitHub" button does,
 * name the commit, and optionally remember the choice so the button runs it
 * directly next time (re-openable via the gear to change later).
 */
export function PublishSettingsDialog({
  open,
  repo,
  defaultMode,
  defaultMessage,
  defaultRemember,
  hasEditorEdits,
  onClose,
  onSubmit,
}: PublishSettingsDialogProps) {
  const [mode, setMode] = useState<PublishMode>(defaultMode);
  const [message, setMessage] = useState(defaultMessage);
  const [remember, setRemember] = useState(false);
  // Stop auto-swapping the message on mode change once the user edits it.
  const [messageTouched, setMessageTouched] = useState(false);

  // Re-seed local state whenever the modal opens, honoring the remembered mode
  // but falling back off "editor" when there are no edits to push.
  useEffect(() => {
    if (!open) return;
    const initialMode = resolveInitialPublishMode(defaultMode, hasEditorEdits);
    setMode(initialMode);
    setMessage(
      initialMode === defaultMode
        ? defaultMessage
        : PUBLISH_MODE_MESSAGES[initialMode],
    );
    setRemember(defaultRemember);
    setMessageTouched(false);
  }, [open, defaultMode, defaultMessage, defaultRemember, hasEditorEdits]);

  const selectMode = (next: PublishMode) => {
    setMode(next);
    if (!messageTouched) setMessage(PUBLISH_MODE_MESSAGES[next]);
  };

  const handleSubmit = () => {
    onSubmit({ mode, commitMessage: message.trim(), remember });
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Publish to GitHub</DialogTitle>
          <DialogDescription>
            Connected to{" "}
            <span className="font-medium">
              {repo.owner}/{repo.repo}
            </span>
            . Choose what to push.
          </DialogDescription>
        </DialogHeader>

        <div
          role="radiogroup"
          aria-label="Publish mode"
          className="space-y-2 py-1"
        >
          {OPTIONS.map((opt) => {
            const disabled = opt.mode === "editor" && !hasEditorEdits;
            const selected = mode === opt.mode;
            return (
              <label
                key={opt.mode}
                className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors ${
                  selected
                    ? "border-primary bg-primary/5"
                    : "border-input hover:bg-accent"
                } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
              >
                <input
                  type="radio"
                  name="publish-mode"
                  className="mt-0.5 h-4 w-4 accent-primary"
                  checked={selected}
                  disabled={disabled}
                  onChange={() => selectMode(opt.mode)}
                />
                <opt.Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="space-y-1">
                  <span className="block font-medium">{opt.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {disabled ? "No local edits to push." : opt.description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>

        {mode !== "new-repo" ? (
          <div className="space-y-2">
            <label
              htmlFor="publish-commit-message"
              className="text-sm font-medium"
            >
              Commit message
            </label>
            <Input
              id="publish-commit-message"
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                setMessageTouched(true);
              }}
              placeholder={PUBLISH_MODE_MESSAGES[mode] || "Update"}
            />
          </div>
        ) : null}

        <label className="flex items-center gap-3 pt-1 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <span className="font-medium">
            Remember my choice
            <span className="ml-1 font-normal text-muted-foreground">
              (skip this next time)
            </span>
          </span>
        </label>

        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={handleSubmit} autoFocus>
            {mode === "new-repo" ? "Continue" : "Push"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
