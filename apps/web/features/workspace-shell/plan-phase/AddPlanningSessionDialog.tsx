"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
  Input,
  Textarea,
  FileDropZone,
} from "@hexagen/ui";
import type { NewProjectLayer } from "@/hooks/useSavedProjects";

interface AddPlanningSessionDialogProps {
  open: boolean;
  onClose: () => void;
  /** Awaited; resolves true when the layer was durably persisted. */
  onSubmit: (layer: NewProjectLayer) => Promise<boolean>;
  /** Human-readable reason shown when the last submit failed (e.g. quota). */
  submitError: string | null;
}

/**
 * Paste / import a planning-session transcript as a brainstorm layer.
 * Deliberately dumb ingestion (no multi-agent auto-parsing): the whole markdown
 * becomes one "Imported" turn — lossless.
 *
 * The submit is AWAITED and the dialog only closes on success: a pasted
 * transcript is hard to reconstruct, so a failed write (most plausibly storage
 * quota) keeps the content in the form with the error shown inline.
 */
export function AddPlanningSessionDialog({
  open,
  onClose,
  onSubmit,
  submitError,
}: AddPlanningSessionDialogProps) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = content.trim().length > 0 && !isSubmitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    try {
      const ok = await onSubmit({
        kind: "brainstorm",
        title: title.trim() || "Planning session",
        turns: [
          {
            id: crypto.randomUUID(),
            author: "Imported",
            content,
            at: Date.now(),
          },
        ],
      });
      if (ok) {
        setTitle("");
        setContent("");
        onClose();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} dismissible={!isSubmitting}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add planning session</DialogTitle>
          <DialogDescription>
            Paste the brainstorm / planning transcript that produced this
            project, or drop a markdown file. It is stored as-is alongside the
            architecture.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Session title (e.g. Initial brainstorm)"
            aria-label="Session title"
            disabled={isSubmitting}
          />
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Paste the markdown transcript here…"
            aria-label="Session transcript (markdown)"
            rows={10}
            className="font-mono text-xs"
            disabled={isSubmitting}
          />
          <FileDropZone
            accept=".md,.markdown,.txt"
            label="Import a markdown transcript file"
            hint={<>Drop a .md transcript here</>}
            onFileLoaded={(fileContent, filename) => {
              setContent(fileContent);
              // Filename is a better default title than nothing; never
              // overwrite one the user already typed.
              setTitle(
                (t) => t || filename.replace(/\.(md|markdown|txt)$/i, ""),
              );
            }}
          />
          {submitError && (
            <p role="alert" className="text-sm text-destructive">
              {submitError}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {isSubmitting ? "Saving…" : "Add session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
