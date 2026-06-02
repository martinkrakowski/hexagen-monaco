"use client";

import { useEffect } from "react";
import { Loader2, CheckCircle2, AlertCircle, X } from "lucide-react";
import {
  isGithubExportActive,
  type ExportState,
} from "@/contexts/ExportContext";

const SUCCESS_AUTO_DISMISS_MS = 4000;

interface ExportStatusStripProps {
  state: ExportState;
  onDismiss: () => void;
}

/**
 * Persistent strip shown below the header bar that surfaces the
 * current export state (progress / success / error). Rendered by
 * the Header so it outlives the ProjectMenu dropdown's close.
 *
 * Solves the previous bug where setIsOpen(false) closed the dropdown
 * before the fetch completed, making the inline status messages
 * unreachable.
 */
export function ExportStatusStrip({
  state,
  onDismiss,
}: ExportStatusStripProps) {
  // Auto-dismiss ZIP success after a few seconds. Errors stay until dismissed.
  // GitHub flows are owned by ExportDialog (see below) — never auto-dismiss
  // them here, or the success dialog would close itself after 4s.
  useEffect(() => {
    if (state.kind !== "success" || isGithubExportActive(state)) return;
    const timer = setTimeout(onDismiss, SUCCESS_AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [state, onDismiss]);

  // The GitHub publish flow is surfaced by ExportDialog (form → submitting →
  // result), so the strip handles only the ZIP path — avoids double feedback.
  if (isGithubExportActive(state)) return null;
  // settings-open is also covered by isGithubExportActive above; listed here so
  // the discriminated union narrows to exporting/success/error below.
  if (
    state.kind === "idle" ||
    state.kind === "dialog-open" ||
    state.kind === "settings-open"
  )
    return null;

  if (state.kind === "exporting") {
    // Only the ZIP path reaches here — the GitHub flow is gated out above and
    // owned by ExportDialog.
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 px-6 py-2 bg-muted/60 border-b border-border text-sm text-muted-foreground"
      >
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Exporting ZIP…</span>
      </div>
    );
  }

  if (state.kind === "success") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 px-6 py-2 bg-success/10 border-b border-success/30 text-sm text-success dark:text-success/80"
      >
        <CheckCircle2 className="w-4 h-4" />
        <span className="flex-1">{state.message}</span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="p-0.5 hover:bg-success/20 rounded"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  // state.kind === "error"
  return (
    <div
      role="alert"
      className="flex items-center gap-2 px-6 py-2 bg-destructive/10 border-b border-destructive/30 text-sm text-destructive"
    >
      <AlertCircle className="w-4 h-4" />
      <span className="flex-1">{state.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="p-0.5 hover:bg-destructive/20 rounded"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
