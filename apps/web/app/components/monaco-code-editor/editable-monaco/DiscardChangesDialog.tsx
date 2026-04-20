"use client";

import dynamic from "next/dynamic";
import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/Dialog";
import { DIFF_EDITOR_OPTIONS } from "./monaco-options";

const DiffEditor = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.DiffEditor),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full bg-muted">
        <span className="text-sm text-muted-foreground">
          Loading diff editor...
        </span>
      </div>
    ),
  },
);

interface DiscardChangesDialogProps {
  open: boolean;
  language: string;
  theme: string;
  originalContent: string;
  modifiedContent: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const DIALOG_BUTTON_BASE =
  "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background h-10 py-2 px-4";

/**
 * Confirmation dialog shown when the user tries to discard unsaved
 * changes. Renders an inline side-by-side diff so the user can see
 * exactly what will be lost.
 *
 * The DiffEditor is only mounted when `open` is true — it's heavy
 * (Monaco instance) and not worth keeping in the DOM otherwise.
 */
export function DiscardChangesDialog({
  open,
  language,
  theme,
  originalContent,
  modifiedContent,
  onConfirm,
  onCancel,
}: DiscardChangesDialogProps) {
  return (
    <Dialog open={open} onClose={onCancel}>
      <DialogContent className="max-w-3xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Discard Changes?
          </DialogTitle>
          <DialogDescription>
            You have unsaved changes. The diff below shows what will be lost.
          </DialogDescription>
        </DialogHeader>

        {/* Avoid mounting the heavyweight DiffEditor when the dialog is closed */}
        {open && (
          <div className="mt-4 rounded-lg overflow-hidden border border-border h-[40vh]">
            <DiffEditor
              original={originalContent}
              modified={modifiedContent}
              language={language}
              theme={theme}
              options={DIFF_EDITOR_OPTIONS}
            />
          </div>
        )}

        <DialogFooter className="mt-4">
          <button
            type="button"
            onClick={onCancel}
            className={`${DIALOG_BUTTON_BASE} border border-input hover:bg-accent hover:text-accent-foreground`}
          >
            Keep Editing
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`${DIALOG_BUTTON_BASE} bg-destructive text-destructive-foreground hover:bg-destructive/90`}
          >
            Discard Changes
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
