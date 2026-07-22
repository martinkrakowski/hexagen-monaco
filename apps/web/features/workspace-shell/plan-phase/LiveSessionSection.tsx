"use client";

import { useMemo, useRef, useState } from "react";
import { Button, Textarea } from "@hexagen/ui";
import { Sparkles, Pause, Play, Square, CheckCheck, Send } from "lucide-react";
import type { ProjectLayer } from "@hexagen/shared";

import { PlanTurnList } from "./PlanTurnList";
import { ChatMarkdown } from "@/chat/ChatMarkdown";
import type { UsePlanningSessionReturn } from "./session/usePlanningSession";
import type { SessionStatus } from "./session/planning-session";
import { buildDistillPrompt, stripYamlFences } from "./session/distill";
import { streamChatTurn } from "./session/stream-chat-turn";
// Cross-slice import is allowed here: workspace-shell is the composition root
// (exempt from no-feature-slice-imports), and the finalize hand-off must use
// the SAME pending-manifest store the import/accept flow reads.
import { usePendingManifest } from "../../manifest-generation/store/usePendingManifest";

const MODEL_NAME = process.env.NEXT_PUBLIC_LLM_MODEL || "gpt-4o-mini";

const STATUS_LABELS: Record<SessionStatus, string> = {
  proposing: "Proposing",
  critiquing: "Critiquing",
  revising: "Revising",
  "awaiting-human": "Awaiting you",
  converged: "Converged",
  finalizing: "Finalizing",
  done: "Done",
};

const STATUS_CHIP_CLASSES: Partial<Record<SessionStatus, string>> = {
  "awaiting-human": "bg-warning/10 text-warning border-warning/20",
  converged: "bg-success/10 text-success border-success/20",
  done: "bg-muted text-muted-foreground border-border",
};

type FinalizeUiState =
  | { phase: "idle" }
  | { phase: "distilling"; content: string }
  | { phase: "review"; text: string }
  | { phase: "error"; message: string };

export interface LiveSessionSectionProps {
  projectId: string;
  layers: readonly ProjectLayer[];
  /** The session loop, owned by the parent (which also filters the active
   * layer out of the archive list — one hook instance, no duplicate render). */
  session: UsePlanningSessionReturn;
  /** Prop-injected navigation (repo convention — testable without a router). */
  onNavigateToImport: () => void;
}

/**
 * The live brainstorm session UI for the Plan phase (Phase 3 v1):
 * seed form → client-driven proposer⇄critic loop (streamed) → human controls
 * (pause / steer / force-converge / end) → finalize (distill → editable
 * review → EXPLICIT confirm → hand-off to the import flow; never
 * auto-navigates).
 */
export function LiveSessionSection(props: LiveSessionSectionProps) {
  const { projectId, layers, session, onNavigateToImport } = props;

  const {
    sessionState,
    activeLayerId,
    draft,
    isRunning,
    turns,
    seed,
    start,
    attach,
    pause,
    resume,
    addSteering,
    forceConverge,
    end,
    beginFinalize,
    cancelFinalize,
    reset,
  } = session;

  const [seedText, setSeedText] = useState("");
  const [steeringText, setSteeringText] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [finalize, setFinalize] = useState<FinalizeUiState>({ phase: "idle" });
  const distillAbortRef = useRef<AbortController | null>(null);
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

  const handleStart = async () => {
    if (!seedText.trim() || isStarting) return;
    setIsStarting(true);
    setStartError(null);
    try {
      const started = await start(seedText);
      // Only a SUCCESSFUL start clears the textarea — a failed layer write
      // must never silently discard the user's typed brief.
      if (started) {
        setSeedText("");
      } else {
        setStartError(
          "Couldn't start the session — the layer could not be saved. Your brief is still here; please try again.",
        );
      }
    } finally {
      setIsStarting(false);
    }
  };

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

  // End must also tear down any finalize in progress: an in-flight distill
  // completing into the review panel of an already-ended session would let
  // Confirm hand off without any layer left to link.
  const handleEnd = () => {
    distillAbortRef.current?.abort();
    distillAbortRef.current = null;
    setFinalize({ phase: "idle" });
    void end();
  };

  const handleAddSteering = async () => {
    const text = steeringText.trim();
    if (!text) return;
    await addSteering(text);
    setSteeringText("");
  };

  const handleFinalizeStart = async () => {
    if (!sessionState || sessionState.status !== "converged") return;
    await beginFinalize();
    setFinalize({ phase: "distilling", content: "" });
    const abortController = new AbortController();
    distillAbortRef.current = abortController;
    const result = await streamChatTurn({
      message: buildDistillPrompt({ seed, turns }),
      model: MODEL_NAME,
      signal: abortController.signal,
      onChunk: (content) => setFinalize({ phase: "distilling", content }),
    });
    distillAbortRef.current = null;
    if (!result.ok) {
      if (result.aborted) return; // cancelled — cancelFinalize already handled
      setFinalize({ phase: "error", message: result.error });
      await cancelFinalize();
      return;
    }
    setFinalize({ phase: "review", text: stripYamlFences(result.content) });
  };

  const handleFinalizeCancel = async () => {
    distillAbortRef.current?.abort();
    distillAbortRef.current = null;
    setFinalize({ phase: "idle" });
    await cancelFinalize();
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

  // ── No session tracked: seed form (+ interrupted banner) ──────────────────
  if (sessionState === null) {
    return (
      <section className="space-y-3" aria-label="Live planning session">
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
              {STATUS_LABELS[interruptedLayer.status ?? "awaiting-human"]}. You
              can pick it up where it left off or end it.
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
            Two AI roles — a proposer and a critic — iterate on your idea until
            it converges, with you steering. Each round uses 2 AI chat requests
            from your daily quota.
          </p>
          <Textarea
            value={seedText}
            onChange={(e) => setSeedText(e.target.value)}
            placeholder="Describe what you want to build (the brief the session starts from)…"
            aria-label="Session brief"
            rows={4}
            disabled={isStarting}
          />
          {startError && (
            <p role="alert" className="text-sm text-destructive">
              {startError}
            </p>
          )}
          <Button
            onClick={() => void handleStart()}
            disabled={!seedText.trim() || isStarting}
          >
            <Sparkles className="w-4 h-4 mr-2" />
            {isStarting ? "Starting…" : "Start live session"}
          </Button>
        </div>
      </section>
    );
  }

  // ── Session panel ──────────────────────────────────────────────────────────
  const { status, round, maxRounds, awaitReason, errorMessage } = sessionState;
  const chipClass =
    STATUS_CHIP_CLASSES[status] ?? "bg-info/10 text-info border-info/20";

  return (
    <section
      className="border border-border rounded-lg p-4 space-y-4"
      aria-label="Live planning session"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">
            Live session
          </h2>
          <span
            data-testid="session-status-chip"
            className={`text-xs px-2 py-0.5 rounded border font-medium ${chipClass}`}
          >
            {STATUS_LABELS[status]}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          Round {round} of {maxRounds}
        </span>
      </div>

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

      {/* The human is a first-class author: steering is available at ANY
          point of a live session (design doc), not just while parked — the
          turn persists immediately and folds into the next model turn. Hidden
          only once the session is terminal. */}
      {status !== "done" && (
        <div className="space-y-2">
          <Textarea
            value={steeringText}
            onChange={(e) => setSteeringText(e.target.value)}
            placeholder="Steer the session (folded into the next model turn)…"
            aria-label="Steering note"
            rows={2}
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void handleAddSteering()}
            disabled={!steeringText.trim()}
          >
            <Send className="w-4 h-4 mr-2" />
            Add steering turn
          </Button>
        </div>
      )}

      {status === "converged" && finalize.phase === "idle" && (
        <p className="text-sm text-muted-foreground">
          The critic signed off. Finalize to distill this session into a spec
          and generate the manifest (uses 1 more AI chat request).
        </p>
      )}

      {finalize.phase === "distilling" && (
        <div className="space-y-2" data-testid="finalize-distilling">
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
            onClick={() => void handleFinalizeCancel()}
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
            This is what the import flow will turn into your manifest — edit it
            before confirming.
          </p>
          <Textarea
            value={finalize.text}
            onChange={(e) =>
              setFinalize({ phase: "review", text: e.target.value })
            }
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
              onClick={() => void handleFinalizeCancel()}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {finalize.phase === "error" && (
        <p role="alert" className="text-sm text-destructive">
          Finalize failed: {finalize.message} — the session is still converged;
          you can retry.
        </p>
      )}

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
        {(status === "awaiting-human" || (isRunning && status !== "done")) && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void forceConverge()}
          >
            <CheckCheck className="w-4 h-4 mr-2" />
            Force converge
          </Button>
        )}
        {/* Also rendered in the "error" phase: a transient distill failure
            (rate limit, network) must leave a retry path — the session is
            back at converged, so finalizing again is always safe. */}
        {status === "converged" &&
          (finalize.phase === "idle" || finalize.phase === "error") && (
            <Button size="sm" onClick={() => void handleFinalizeStart()}>
              <Sparkles className="w-4 h-4 mr-2" />
              Finalize → Generate manifest
            </Button>
          )}
        {status !== "done" && (
          <Button size="sm" variant="secondary" onClick={handleEnd}>
            <Square className="w-4 h-4 mr-2" />
            End session
          </Button>
        )}
      </div>

      {status === "done" && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Session complete. The transcript is stored as a planning layer
            below.
          </p>
          <Button size="sm" variant="secondary" onClick={reset}>
            <Sparkles className="w-4 h-4 mr-2" />
            Start another session
          </Button>
        </div>
      )}
    </section>
  );
}
