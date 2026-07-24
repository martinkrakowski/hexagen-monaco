"use client";

import { FileText, PenLine } from "lucide-react";

interface GenesisSourcesSectionProps {
  /** The original imported/pasted spec text carried by usePendingManifest;
   * `null` in the plain prompt flow (no source document exists). */
  originSpecText: string | null;
}

/** First line of the spec, truncated, as the read-only Source row's excerpt. */
function specExcerpt(text: string): string {
  const firstLine = text.trimStart().split("\n", 1)[0] ?? "";
  return firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine;
}

/**
 * GENESIS Section B — "Sessions & sources" (Plan Workbench C1, plan §3.2).
 * Pre-save there are no planning layers and no live session, so the section
 * is read-only: the "Draft brief" row stands for the description being
 * composed in the right pane (the only resource this flow has), plus a
 * read-only "Source" row when a pending origin spec exists. Rows are static
 * — genesis has a single main view, so there is nothing to select — and the
 * muted availability line is the locked §5 Q1 home for the sessions hint
 * (never a disabled footer button; the "Add planning session" footer is
 * hidden entirely in genesis).
 */
export function GenesisSourcesSection({
  originSpecText,
}: GenesisSourcesSectionProps) {
  return (
    <div aria-label="Sessions and sources" className="space-y-1">
      <div className="rounded-md px-2 py-2 bg-muted">
        <span className="flex items-center gap-2">
          <PenLine aria-hidden="true" className="w-3.5 h-3.5 text-primary" />
          <span className="text-sm font-medium text-foreground">
            Draft brief
          </span>
        </span>
      </div>

      {originSpecText !== null && (
        <div className="rounded-md px-2 py-2">
          <span className="flex items-center gap-2 min-w-0">
            <FileText
              aria-hidden="true"
              className="w-3.5 h-3.5 text-muted-foreground shrink-0"
            />
            <span className="text-sm text-foreground">Source</span>
          </span>
          <span className="block text-xs text-muted-foreground mt-0.5 truncate">
            {specExcerpt(originSpecText)}
          </span>
        </div>
      )}

      <p className="text-xs text-muted-foreground px-2 py-1.5">
        Planning sessions are available after you save
      </p>
    </div>
  );
}
