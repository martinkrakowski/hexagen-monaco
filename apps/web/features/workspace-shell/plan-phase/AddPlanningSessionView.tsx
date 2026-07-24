"use client";

import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Button, Checkbox, Input, Textarea, FileDropZone } from "@hexagen/ui";
import type { NewProjectLayer } from "@/hooks/useSavedProjects";
import { splitTurnsByAuthorHeadings } from "./split-turns";

/** The add-session form's draft — LIFTED to the host (like the composer
 * draft): this view is conditionally rendered, so any host-level leave (a
 * sessions-row click) unmounts it mid-edit, and a pasted transcript is hard
 * to reconstruct. The former always-mounted dialog preserved this state
 * structurally; the inline view must do it explicitly. */
export interface AddSessionDraft {
  title: string;
  content: string;
  splitEnabled: boolean;
}

export const EMPTY_ADD_SESSION_DRAFT: AddSessionDraft = {
  title: "",
  content: "",
  splitEnabled: true,
};

export interface AddPlanningSessionViewProps {
  /** Leaves the view without submitting (the host restores the URL-derived
   * view — the add-session view is transient state, never in the URL). The
   * DRAFT survives a cancel: only a successful submit resets it. */
  onCancel: () => void;
  /** Awaited; resolves true when the layer was durably persisted. On success
   * the HOST leaves this view and selects the new layer's reader. */
  onSubmit: (layer: NewProjectLayer) => Promise<boolean>;
  /** Human-readable reason shown when the last submit failed (e.g. quota). */
  submitError: string | null;
  /** Controlled draft, owned by the host (see AddSessionDraft). */
  draft: AddSessionDraft;
  /** Functional-updater contract (a useState setter satisfies it): writes
   * that complete asynchronously (FileReader onload) must build on the
   * LATEST draft, not the render-time one they closed over — otherwise a
   * title typed while the file was loading gets clobbered by the stale
   * spread. */
  onDraftChange: Dispatch<SetStateAction<AddSessionDraft>>;
}

/**
 * Paste / import a planning-session transcript as a brainstorm layer —
 * rendered INLINE as the workbench's right-pane main view (plan req 4b; the
 * former AddPlanningSessionDialog, now full-height instead of modal). Default
 * ingestion is deliberately dumb (the whole markdown becomes one "Imported"
 * turn — lossless); when the paste carries `## Author` heading delimiters, an
 * opt-out checkbox splits it into one turn per section instead (see
 * split-turns.ts).
 *
 * The submit is AWAITED and the draft only resets on success: a pasted
 * transcript is hard to reconstruct, so a failed write (most plausibly storage
 * quota) keeps the content in the form with the error shown inline. For the
 * same reason the draft itself is CONTROLLED (host-owned): a host-level leave
 * of this view (sessions-row click) unmounts it, and the transcript must
 * survive the round trip.
 */
export function AddPlanningSessionView({
  onCancel,
  onSubmit,
  submitError,
  draft,
  onDraftChange,
}: AddPlanningSessionViewProps) {
  const { title, content, splitEnabled } = draft;
  const [isSubmitting, setIsSubmitting] = useState(false);

  // null = no split offered (fewer than two `## Author` headings). A detected
  // split with zero usable turns (all sections empty) is treated as no split —
  // it must never produce a turn-less layer.
  const detectedTurns = useMemo(() => {
    const turns = splitTurnsByAuthorHeadings(content);
    return turns && turns.length > 0 ? turns : null;
  }, [content]);

  const canSubmit = content.trim().length > 0 && !isSubmitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    try {
      const at = Date.now();
      const turns =
        detectedTurns && splitEnabled
          ? detectedTurns.map((turn) => ({
              id: crypto.randomUUID(),
              author: turn.author,
              content: turn.content,
              at,
            }))
          : [
              {
                id: crypto.randomUUID(),
                author: "Imported",
                content,
                at,
              },
            ];
      const ok = await onSubmit({
        kind: "brainstorm",
        title: title.trim() || "Planning session",
        turns,
      });
      if (ok) {
        // The host unmounts this view on success (it selects the new layer's
        // reader); reset the lifted draft anyway so the contract doesn't
        // depend on that. (Calling the host setter from a possibly-unmounted
        // continuation is fine — the state lives in the host.)
        onDraftChange(EMPTY_ADD_SESSION_DRAFT);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section aria-label="Add planning session" className="h-full flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
        <header className="space-y-1">
          <h2 className="text-sm font-semibold text-foreground">
            Add planning session
          </h2>
          <p className="text-sm text-muted-foreground">
            Paste the brainstorm / planning transcript that produced this
            project, or drop a markdown file. It is stored as-is alongside the
            architecture.
          </p>
        </header>

        <Input
          value={title}
          onChange={(e) => {
            const title = e.target.value;
            onDraftChange((prev) => ({ ...prev, title }));
          }}
          placeholder="Session title (e.g. Initial brainstorm)"
          aria-label="Session title"
          disabled={isSubmitting}
        />
        <Textarea
          value={content}
          onChange={(e) => {
            const content = e.target.value;
            onDraftChange((prev) => ({ ...prev, content }));
          }}
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
            // ONE draft update for both fields: filename is a better default
            // title than nothing, but never overwrite one the user typed.
            // FUNCTIONAL update is load-bearing here: FileReader completes
            // asynchronously, so a spread of the render-time draft would
            // clobber a title typed while the file was still loading.
            onDraftChange((prev) => ({
              ...prev,
              content: fileContent,
              title:
                prev.title || filename.replace(/\.(md|markdown|txt)$/i, ""),
            }));
          }}
        />
        {detectedTurns && (
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
              <Checkbox
                checked={splitEnabled}
                onCheckedChange={(checked) =>
                  onDraftChange((prev) => ({ ...prev, splitEnabled: checked }))
                }
                disabled={isSubmitting}
              />
              Split into turns by <code>## Author</code> headings
            </label>
            <span className="text-xs text-muted-foreground">
              {detectedTurns.length}{" "}
              {detectedTurns.length === 1 ? "turn" : "turns"} detected
            </span>
          </div>
        )}
        {submitError && (
          <p role="alert" className="text-sm text-destructive">
            {submitError}
          </p>
        )}
      </div>

      <footer className="shrink-0 border-t border-border p-3 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button onClick={() => void handleSubmit()} disabled={!canSubmit}>
          {isSubmitting ? "Saving…" : "Add session"}
        </Button>
      </footer>
    </section>
  );
}
