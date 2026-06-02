"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@hexagen/ui";

import { useEditorGuard } from "@/contexts/EditorGuardContext";

interface UnsavedEditorChangesDialogProps {
  isOpen: boolean;
  /** Cancel — keep editing, stay on the page. */
  onClose: () => void;
  /** Continue the pending in-app navigation (after save/discard). */
  onProceed: () => void;
}

/**
 * Shown when the user navigates within the app while the editor has unsaved
 * changes. Save / Discard proceed with the pending navigation; Cancel stays.
 */
export function UnsavedEditorChangesDialog({
  isOpen,
  onClose,
  onProceed,
}: UnsavedEditorChangesDialogProps) {
  const { save, discard } = useEditorGuard();
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={isOpen} onClose={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Unsaved changes</DialogTitle>
          <DialogDescription>
            You have unsaved changes in the editor. Save them, discard them, or
            cancel to keep editing.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 mt-4">
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await save();
              } catch {
                setBusy(false);
                return;
              }
              setBusy(false);
              onProceed();
            }}
            className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm font-medium disabled:opacity-50"
          >
            Save changes
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              discard();
              onProceed();
            }}
            className="w-full px-4 py-2 border border-destructive text-destructive rounded-md hover:bg-destructive/10 text-sm disabled:opacity-50"
          >
            Discard changes
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="w-full px-4 py-2 border border-input bg-background rounded-md hover:bg-muted text-sm disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
