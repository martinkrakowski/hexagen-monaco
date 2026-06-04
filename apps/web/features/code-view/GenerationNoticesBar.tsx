"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Info, X } from "lucide-react";

export interface GenerationNotices {
  /** Generated files an add-on overrode — informational. */
  warnings: string[];
  /** Add-on selections that were omitted (bad selection) — see the sidecar. */
  errors: string[];
}

/**
 * Surfaces add-on materialization notices from the last generation, at the top
 * of the code view. Severity uses the shared semantic tokens:
 *
 * - **errors** flip the bar to `warning` (amber, AlertTriangle) — the project
 *   still generated, but selected add-ons were omitted; the detail lives in the
 *   project's `HEXAGEN-ADDON-NOTICES.md`. Amber, not red: generation succeeded
 *   (`destructive`/red is reserved for an actual generation failure).
 * - **only warnings** render as a muted, informational count — overrides merged
 *   fine, so they shouldn't shout.
 *
 * Dismissible; re-appears when a new generation produces notices.
 */
export function GenerationNoticesBar({
  notices,
}: {
  notices: GenerationNotices;
}) {
  const [dismissed, setDismissed] = useState(false);
  const errorCount = notices.errors.length;
  const warningCount = notices.warnings.length;

  // Re-show when a fresh generation changes the notices (the hook hands back a
  // new object each run), so a dismissal doesn't hide later issues.
  useEffect(() => setDismissed(false), [notices]);

  if (dismissed || (errorCount === 0 && warningCount === 0)) return null;

  const hasErrors = errorCount > 0;

  return (
    <div
      // Always a non-failure advisory (generation succeeded; add-ons were just
      // omitted/overridden) — so `status` + polite, never an assertive `alert`.
      role="status"
      aria-live="polite"
      className={
        hasErrors
          ? "flex items-start gap-2 px-4 py-2 border-b border-warning/30 bg-warning/10 text-sm text-warning"
          : "flex items-start gap-2 px-4 py-2 border-b border-border bg-muted/40 text-sm text-muted-foreground"
      }
    >
      {hasErrors ? (
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
      ) : (
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
      )}
      <div className="flex-1 space-y-0.5">
        {hasErrors && (
          <p>
            {errorCount} add-on{errorCount === 1 ? " was" : "s were"} not
            applied — see{" "}
            <code className="font-mono">HEXAGEN-ADDON-NOTICES.md</code> in the
            project.
          </p>
        )}
        {warningCount > 0 && (
          <p className={hasErrors ? "text-muted-foreground" : undefined}>
            {warningCount} generated file{warningCount === 1 ? "" : "s"}{" "}
            overridden by add-ons.
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss notices"
        className={
          hasErrors
            ? "p-0.5 hover:bg-warning/20 rounded"
            : "p-0.5 hover:bg-muted rounded"
        }
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
