"use client";

import { useMemo } from "react";
import { Button, Textarea } from "@hexagen/ui";
import { Sparkles, Pause, Play, Square, CheckCheck } from "lucide-react";
import type { ProjectLayer } from "@hexagen/shared";

import { PlanTurnList } from "./PlanTurnList";
import { ChatMarkdown } from "@/chat/ChatMarkdown";
import type { UsePlanningSessionReturn } from "./session/usePlanningSession";
import { STATUS_LABELS, statusChipClass } from "./session-status-presentation";
// Cross-slice import is allowed here: workspace-shell is the composition root
// (exempt from no-feature-slice-imports), and the finalize hand-off must use
// the SAME pending-manifest store the import/accept flow reads.
import { usePendingManifest } from "../../manifest-generation/store/usePendingManifest";

export interface LiveSessionSectionProps {
  projectId: string;
  layers: readonly ProjectLayer[];
  /** The session loop, owned by the plan host (which also filters the active
   * layer out of the archive list — one hook instance, no duplicate render). */
  session: UsePlanningSessionReturn;
  /** Prop-injected navigation (repo convention — testable without a router). */
  onNavigateToImport: () => void;
  /** Opens the inline add-session view. Plan §3.2: "The EMPTY MAIN VIEW keeps
   * a secondary 'Add an existing transcript' action" — rendered only in the
   * zero-layer, no-session state (the pre-workbench empty state's home was
   * this main column too); the left-footer button stays the primary home. */
  onAddSession?: () => void;
}

/**
 * The workbench right pane's LIVE view (Plan Workbench A2): full-height
 * transcript of the running proposer⇄critic session with pinned status header
 * and loop controls, plus the lifted finalize panels (distill → editable
 * review → EXPLICIT confirm → hand-off to the import flow; never
 * auto-navigates).
 *
 * Deliberately STATELESS about drafts and finalize: the seed/steering
 * composer lives in the host (pinned under the pane) and the finalize state
 * lives in usePlanningSession — a view switch unmounts this component, and
 * neither typed drafts nor a distill in progress may die with it.
 */
export function LiveSessionSection(props: LiveSessionSectionProps) {
  const { projectId, layers, session, onNavigateToImport, onAddSession } =
    props;

  const {
    sessionState,
    activeLayerId,
    draft,
    isRunning,
    turns,
    attach,
    pause,
    resume,
    forceConverge,
    end,
    finalize,
    abandonFinalize,
    setFinalizeReviewText,
    reset,
  } = session;

  const pendingManifest = usePendingManifest();

  // A persisted session layer with a non-terminal status and NO loop running
  // in this mount = an interrupted session (the tab died mid-loop, Q0).
  const interruptedLayer = useMemo(() => {
    if (sessionState !== null) return null;
    const candidates = layers.filter(
      (l) => l.status !== undefined && l.status !== "done",
    );
    if (candidates.length === 0) return null;
    return candidates.reduce((a, b) => (b.updatedAt >= a.updatedAt ? b : a));
  }, [layers, sessionState]);

  const handleResumeInterrupted = (layer: ProjectLayer) => {
    attach(layer);
    // attach() parks an interrupted ACTIVE status as awaiting-human(paused);
    // resume re-enters the loop. For converged/finalizing layers resume is an
    // identity no-op and the panel simply shows the right controls.
    void resume();
  };

  const handleEndInterrupted = (layer: ProjectLayer) => {
    attach(layer);
    void end();
  };

  // The EXPLICIT confirm — the only place that hands off and navigates.
  const handleFinalizeConfirm = () => {
    if (finalize.phase !== "review" || !activeLayerId) return;
    const specText = finalize.text.trim();
    if (!specText) return;
    // Session provenance rides in the pending-manifest store (NOT
    // sessionStorage): the accept-save attaches the full transcript to the
    // NEW project, guarded by an exact match on this spec text.
    pendingManifest.setOriginSession({
      specText,
      turns,
      sourceProjectId: projectId,
      sourceLayerId: activeLayerId,
    });
    // The import page itself rehydrates its editor from this key (its own
    // pre-existing mechanism); the session transcript deliberately does NOT
    // travel through sessionStorage.
    sessionStorage.setItem("import_spec_content", specText);
    sessionStorage.setItem("import_spec_original_content", specText);
    // Deliberately NO terminal stamp here: the source layer stays
    // "finalizing" until the import flow's accept-save marks it done + linked
    // (via originSession) — the hand-off isn't successful until a manifest
    // actually exists. The review panel also stays open, because
    // onNavigateToImport routes through the workspace-exit guard dialog and
    // the user may cancel it; a premature done-stamp + panel reset stranded a
    // terminal layer with no manifest and no way back into the review.
    onNavigateToImport();
  };

  // ── No session tracked: intro (+ interrupted banner); seed = host composer ──
  if (sessionState === null) {
    return (
      <section
        className="h-full flex flex-col"
        aria-label="Live planning session"
      >
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
          {interruptedLayer && (
            <div
              role="status"
              className="border border-warning/40 bg-warning/10 rounded-lg p-4 space-y-2"
            >
              <p className="text-sm font-medium text-foreground">
                A live session was interrupted
              </p>
              <p className="text-sm text-muted-foreground">
                “{interruptedLayer.title}” stopped at{" "}
                {STATUS_LABELS[interruptedLayer.status ?? "awaiting-human"]}.
                You can pick it up where it left off or end it.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => handleResumeInterrupted(interruptedLayer)}
                >
                  <Play className="w-4 h-4 mr-2" />
                  Resume session
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleEndInterrupted(interruptedLayer)}
                >
                  <Square className="w-4 h-4 mr-2" />
                  End session
                </Button>
              </div>
            </div>
          )}

          <div className="border border-border rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">
                Start a live session
              </h2>
            </div>
            <p className="text-sm text-muted-foreground">
              Two AI roles — a proposer and a critic — iterate on your idea
              until it converges, with you steering. Describe what you want to
              build in the composer below to begin.
            </p>
          </div>

          {layers.length === 0 && onAddSession && (
            // Secondary action, EMPTY MAIN VIEW only (plan §3.2): a zero-layer
            // project lands here, and today's empty state keeps pitching
            // transcript import. Once the project has any layer this is no
            // longer the empty state and the pitch disappears — the left
            // footer remains the action's primary, permanent home.
            <p className="text-sm text-muted-foreground">
              Already brainstormed elsewhere?{" "}
              <button
                type="button"
                onClick={onAddSession}
                className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
              >
                Add an existing transcript
              </button>
            </p>
          )}
        </div>
      </section>
    );
  }

  // ── Session panel ──────────────────────────────────────────────────────────
  const { status, round, maxRounds, awaitReason, errorMessage } = sessionState;

  return (
    <section
      className="h-full flex flex-col"
      aria-label="Live planning session"
    >
      <header className="shrink-0 border-b border-border px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">
              Live session
            </h2>
            <span
              data-testid="session-status-chip"
              className={`text-xs px-2 py-0.5 rounded border font-medium ${statusChipClass(status)}`}
            >
              {STATUS_LABELS[status]}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            Round {round} of {maxRounds}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          {isRunning && (
            <Button size="sm" variant="secondary" onClick={() => void pause()}>
              <Pause className="w-4 h-4 mr-2" />
              Pause
            </Button>
          )}
          {status === "awaiting-human" && (
            <Button size="sm" onClick={() => void resume()}>
              <Play className="w-4 h-4 mr-2" />
              Resume
            </Button>
          )}
          {(status === "awaiting-human" ||
            (isRunning && status !== "done")) && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void forceConverge()}
            >
              <CheckCheck className="w-4 h-4 mr-2" />
              Force converge
            </Button>
          )}
          {/* No Finalize button here: it lives in the SHELL FOOTER (locked
              decision §5 Q2 — footer empty until converged). End tears down
              any finalize in progress inside the hook. */}
          {status !== "done" && (
            <Button size="sm" variant="secondary" onClick={() => void end()}>
              <Square className="w-4 h-4 mr-2" />
              End session
            </Button>
          )}
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        <PlanTurnList turns={turns} />

        {draft && (
          <div
            data-testid="streaming-draft"
            className="border-l-2 border-l-primary/60 bg-card rounded-r-md px-4 py-3"
          >
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-xs font-semibold text-foreground">
                {draft.role === "critic" ? "Critic" : "Proposer"}
              </span>
              <span className="text-xs text-muted-foreground animate-pulse">
                thinking…
              </span>
            </div>
            {draft.content ? <ChatMarkdown content={draft.content} /> : null}
          </div>
        )}

        {status === "awaiting-human" && (
          <div className="space-y-3">
            {awaitReason === "error" && errorMessage && (
              <p role="alert" className="text-sm text-destructive">
                The session hit an error and is paused: {errorMessage}
              </p>
            )}
            {awaitReason === "cap-reached" && (
              <p className="text-sm text-muted-foreground">
                Round cap reached ({maxRounds}). Resume to run another round,
                force convergence, or end the session.
              </p>
            )}
          </div>
        )}

        {status === "converged" && finalize.phase === "idle" && (
          <p className="text-sm text-muted-foreground">
            The critic signed off. Finalize to distill this session into a spec
            and generate the manifest (uses 1 more AI chat request).
          </p>
        )}

        {finalize.phase === "distilling" && (
          // role="status": announce distill progress to assistive tech
          // (consistent with the interrupted banner above).
          <div
            role="status"
            className="space-y-2"
            data-testid="finalize-distilling"
          >
            <p className="text-sm text-muted-foreground animate-pulse">
              Distilling the session into a spec…
            </p>
            {finalize.content && (
              <pre className="text-xs bg-card border border-border rounded p-3 max-h-48 overflow-y-auto whitespace-pre-wrap">
                {finalize.content}
              </pre>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void abandonFinalize()}
            >
              Cancel
            </Button>
          </div>
        )}

        {finalize.phase === "review" && (
          <div className="space-y-2" data-testid="finalize-review">
            <p className="text-sm font-medium text-foreground">
              Review the distilled spec
            </p>
            <p className="text-sm text-muted-foreground">
              This is what the import flow will turn into your manifest — edit
              it before confirming.
            </p>
            <Textarea
              value={finalize.text}
              onChange={(e) => setFinalizeReviewText(e.target.value)}
              aria-label="Distilled spec"
              rows={12}
              className="font-mono text-xs"
            />
            <div className="flex gap-2">
              <Button
                onClick={() => void handleFinalizeConfirm()}
                disabled={!finalize.text.trim()}
              >
                <CheckCheck className="w-4 h-4 mr-2" />
                Confirm and continue to import
              </Button>
              <Button
                variant="secondary"
                onClick={() => void abandonFinalize()}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {finalize.phase === "error" && (
          <p role="alert" className="text-sm text-destructive">
            Finalize failed: {finalize.message} — the session is still
            converged; you can retry.
          </p>
        )}

        {status === "done" && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Session complete. The transcript is stored as a planning layer in
              the sessions list.
            </p>
            <Button size="sm" variant="secondary" onClick={reset}>
              <Sparkles className="w-4 h-4 mr-2" />
              Start another session
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
