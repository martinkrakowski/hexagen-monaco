"use client";

import { useEffect } from "react";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  X,
} from "lucide-react";
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
    // Keep notices on screen — don't auto-dismiss a success that carries add-on
    // warnings/errors, so the user can read them and find the sidecar.
    if (
      state.notices &&
      (state.notices.errors > 0 || state.notices.warnings > 0)
    )
      return;
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
    const errorCount = state.notices?.errors ?? 0;
    const warningCount = state.notices?.warnings ?? 0;
    // Errors → amber (project shipped, add-ons omitted); only-warnings → green
    // with a muted suffix; clean success → green. Red stays for a real failure.
    const hasErrors = errorCount > 0;
    const detail = hasErrors
      ? `${state.message} — ${errorCount} add-on${errorCount === 1 ? "" : "s"} omitted; see HEXAGEN-ADDON-NOTICES.md`
      : warningCount > 0
        ? `${state.message} · ${warningCount} file${warningCount === 1 ? "" : "s"} overridden by add-ons`
        : state.message;
    return (
      <div
        role="status"
        aria-live="polite"
        className={
          hasErrors
            ? "flex items-center gap-2 px-6 py-2 bg-warning/10 border-b border-warning/30 text-sm text-warning"
            : "flex items-center gap-2 px-6 py-2 bg-success/10 border-b border-success/30 text-sm text-success dark:text-success/80"
        }
      >
        {hasErrors ? (
          <AlertTriangle className="w-4 h-4 shrink-0" />
        ) : (
          <CheckCircle2 className="w-4 h-4" />
        )}
        <span className="flex-1">{detail}</span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className={
            hasErrors
              ? "p-0.5 hover:bg-warning/20 rounded"
              : "p-0.5 hover:bg-success/20 rounded"
          }
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
