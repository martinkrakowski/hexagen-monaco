"use client";

import { useState } from "react";
import { Badge, Button, Input, Spinner } from "@hexagen/ui";
import { Check, Pencil, Sparkles, Trash2, X } from "lucide-react";
import type { ProjectLayer } from "@hexagen/shared";

import { PlanTurnList } from "./PlanTurnList";

export interface PlanLayerReaderProps {
  layer: ProjectLayer;
  /** Awaited; resolves true when the rename was durably persisted. */
  onRename: (title: string) => Promise<boolean>;
  /**
   * Opens the delete confirm dialog. UNDEFINED for the active session's layer
   * — deleting the layer the loop writes to would strand the session — so the
   * Delete affordance is hidden entirely.
   */
  onRequestDelete?: () => void;
  /**
   * Brainstorm layers only: run the LLM decisions extraction. Resolves to an
   * error message on failure, or null on success (the new decisions layer is
   * appended by the caller).
   */
  onExtractDecisions?: () => Promise<string | null>;
  /** Rendered when this layer produced the manifest (link provenance). */
  onSwitchToArchitecture?: () => void;
}

/**
 * Full-height reader for one archived planning layer (the workbench's
 * right-pane "layer" view): pinned header with title/rename/kind badge and
 * the layer actions, scrollable full transcript below. Archived layers are
 * READ-ONLY transcripts (locked decision §5 Q3) — rename/extract/delete are
 * metadata operations, never turn edits.
 *
 * Hosts should key this component by `layer.id` so rename-in-progress state
 * can't leak across a row switch in the sessions list.
 */
export function PlanLayerReader({
  layer,
  onRename,
  onRequestDelete,
  onExtractDecisions,
  onSwitchToArchitecture,
}: PlanLayerReaderProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(layer.title);
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);

  const producedManifest = layer.link?.type === "produced-manifest";
  const isDecisions = layer.kind === "decisions";

  const startRename = () => {
    setDraftTitle(layer.title);
    setRenameError(null);
    setIsRenaming(true);
  };

  const cancelRename = () => {
    setIsRenaming(false);
    setRenameError(null);
  };

  const commitRename = async () => {
    const next = draftTitle.trim();
    if (!next || next === layer.title) {
      cancelRename();
      return;
    }
    setIsSavingTitle(true);
    try {
      const ok = await onRename(next);
      if (ok) {
        setIsRenaming(false);
        setRenameError(null);
      } else {
        // Keep the editor open with the draft — the awaited write failed.
        setRenameError("Couldn't save the new title. Please try again.");
      }
    } finally {
      setIsSavingTitle(false);
    }
  };

  const runExtraction = async () => {
    if (!onExtractDecisions || isExtracting) return;
    setExtractError(null);
    setIsExtracting(true);
    try {
      const error = await onExtractDecisions();
      if (error) setExtractError(error);
    } finally {
      setIsExtracting(false);
    }
  };

  return (
    <section
      aria-label={`Planning session: ${layer.title}`}
      className="h-full flex flex-col"
    >
      <header className="shrink-0 border-b border-border px-4 py-3 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0 space-y-1">
            {isRenaming ? (
              <div className="flex items-center gap-1">
                <Input
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  aria-label="Session title"
                  disabled={isSavingTitle}
                  className="h-8 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void commitRename();
                    if (e.key === "Escape") cancelRename();
                  }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void commitRename()}
                  disabled={isSavingTitle || !draftTitle.trim()}
                  aria-label="Save title"
                >
                  {isSavingTitle ? (
                    <Spinner className="w-4 h-4" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={cancelRename}
                  disabled={isSavingTitle}
                  aria-label="Cancel rename"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-semibold text-foreground truncate">
                  {layer.title}
                </h2>
                <Badge variant={isDecisions ? "default" : "secondary"}>
                  {isDecisions ? "Decisions" : "Brainstorm"}
                </Badge>
                {producedManifest && (
                  <Badge variant="outline">Produced this architecture</Badge>
                )}
                <button
                  type="button"
                  onClick={startRename}
                  aria-label="Rename session"
                  className="p-1 rounded hover:bg-muted text-muted-foreground"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            {renameError && (
              <p role="alert" className="text-xs text-destructive">
                {renameError}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {layer.turns.length} {layer.turns.length === 1 ? "turn" : "turns"}
              {" · updated "}
              {/* Locale/timezone-dependent text node — scoped hydration
                  tolerance, the repo's pattern for toLocaleString() output. */}
              <span suppressHydrationWarning>
                {new Date(layer.updatedAt).toLocaleString()}
              </span>
            </p>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {producedManifest && onSwitchToArchitecture && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onSwitchToArchitecture}
                className="text-xs"
              >
                View architecture →
              </Button>
            )}
            {!isDecisions && onExtractDecisions && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void runExtraction()}
                disabled={isExtracting}
                className="text-xs"
              >
                {isExtracting ? (
                  <>
                    <Spinner className="w-3.5 h-3.5 mr-1" />
                    Extracting…
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5 mr-1" />
                    Extract decisions
                  </>
                )}
              </Button>
            )}
            {onRequestDelete && (
              <button
                type="button"
                onClick={onRequestDelete}
                aria-label="Delete session"
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {extractError && (
          <p role="alert" className="text-xs text-destructive">
            {extractError}
          </p>
        )}
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <PlanTurnList turns={layer.turns} />
      </div>
    </section>
  );
}
