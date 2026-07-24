"use client";

import { useMemo, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@hexagen/ui";
import { Plus, Sparkles } from "lucide-react";
import type { ProjectLayer } from "@hexagen/shared";
import { useWizardLifecycleContext } from "../contexts/WizardLifecycleContext";
// Cross-slice import is allowed here: workspace-shell is the composition root
// (exempt from no-feature-slice-imports) and the plan phase mounts inside the
// same projects shell chrome as the landing/import screens.
import { ProjectsShellWithFreeTier } from "@/landing/ProjectsShellWithFreeTier";
import { TextareaComposer } from "@/chat/TextareaComposer";
import { PlanWorkbench, type WorkbenchMainView } from "./PlanWorkbench";
import { ProjectSettingsSection } from "./ProjectSettingsSection";
import { SessionsSourcesList } from "./SessionsSourcesList";
import { PlanLayerReader } from "./PlanLayerReader";
import { AddPlanningSessionDialog } from "./AddPlanningSessionDialog";
import { LiveSessionSection } from "./LiveSessionSection";
import { usePlanningSession } from "./session/usePlanningSession";
import type { NewProjectLayer } from "@/hooks/useSavedProjects";

export interface PlanPhaseViewProps {
  /** Prop-injected navigation to the spec-import flow (finalize hand-off) —
   * repo convention: no router coupling, no auto-navigate outside an explicit
   * user confirm. */
  onNavigateToImport: () => void;
  /**
   * Prop-injected phase switch (the repo's router-injection test pattern):
   * rendered as the "View architecture →" affordance on the layer that
   * produced the manifest. Fires on user click only — never auto-navigates.
   */
  onSwitchToArchitecture?: () => void;
}

/**
 * The "Plan" phase of the saved-project workspace, as the two-pane WORKBENCH
 * (Plan Workbench A2): this component is the WIRING HOST — it owns every
 * context read (wizard lifecycle), the single usePlanningSession instance,
 * the right-pane view selection, and the shared composer draft, and feeds the
 * purely presentational PlanWorkbench through adapter props.
 *
 * Reads the project LIVE from the wizard lifecycle context — the same
 * useSavedProjects instance the wizard autosave writes through — so an added
 * layer can't be clobbered by a stale-snapshot autosave, and there is no copy
 * in ActiveWorkspaceContext to go stale.
 */
export function PlanPhaseView({
  onNavigateToImport,
  onSwitchToArchitecture,
}: PlanPhaseViewProps) {
  const {
    loadedProject,
    addLayer,
    updateLayer,
    appendLayerTurn,
    removeLayer,
    updateProjectFormState,
    layersPersistError,
    clearLayersPersistError,
  } = useWizardLifecycleContext();
  const [dialogOpen, setDialogOpen] = useState(false);
  // persistError is instance-wide (any saved-projects write can set it, e.g. a
  // failed wizard autosave). Show it in the dialog only after a submit from
  // THIS dialog actually failed — never a stale error from an earlier,
  // unrelated write.
  const [submitFailed, setSubmitFailed] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectLayer | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Right-pane selection — LOCAL state in A2; PR B moves it to a `?layer=`
  // URL param (subscribed HERE, never through ProjectWorkspaceLayout props —
  // its React.memo comparator hand-picks props and would swallow updates).
  const [mainView, setMainView] = useState<WorkbenchMainView>({
    kind: "live",
  });
  // ONE shared composer draft, lifted to the host: the composer unmounts on a
  // view switch (and on the mobile tab switch), and typed text must survive.
  const [composerDraft, setComposerDraft] = useState("");
  const [startError, setStartError] = useState<string | null>(null);

  const layers = useMemo(
    () => loadedProject?.layers ?? [],
    [loadedProject?.layers],
  );

  // The live-session loop is owned HERE (single hook instance, mounted for
  // the whole plan phase) so the active session's layer can be filtered out
  // of the sessions list AND so the lifted finalize state survives right-pane
  // view switches (the whole point of the A2 state lift).
  const session = usePlanningSession({
    projectId: loadedProject?.id ?? null,
    addLayer,
    appendLayerTurn,
    updateLayer,
  });

  // View-union guards: the active session's layer always normalizes to the
  // live view (its turns must never render twice), and an unknown/deleted id
  // falls back to live instead of a blank pane.
  const resolvedView: WorkbenchMainView = useMemo(() => {
    if (mainView.kind === "layer") {
      if (mainView.layerId === session.activeLayerId) return { kind: "live" };
      if (!layers.some((l) => l.id === mainView.layerId))
        return { kind: "live" };
    }
    return mainView;
  }, [mainView, session.activeLayerId, layers]);

  // Gated by the phase toggle (edit mode with a real project id), but a direct
  // ?phase=plan URL in genesis mode still lands here — render the guard state
  // rather than crash or silently no-op.
  if (!loadedProject) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <p className="text-sm text-muted-foreground">
          Save the project to attach planning sessions.
        </p>
      </div>
    );
  }

  // The active live-session layer renders as the pinned "Live session" row —
  // filter it out here so it never appears as an archived row too.
  const archivedLayers = layers.filter((l) => l.id !== session.activeLayerId);

  const selectedLayer =
    resolvedView.kind === "layer"
      ? (layers.find((l) => l.id === resolvedView.layerId) ?? null)
      : null;

  const handleSubmit = async (layer: NewProjectLayer): Promise<boolean> => {
    clearLayersPersistError();
    setSubmitFailed(false);
    const layerId = await addLayer(loadedProject.id, layer);
    if (layerId === null) setSubmitFailed(true);
    return layerId !== null;
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setSubmitFailed(false);
  };

  const submitError = submitFailed
    ? layersPersistError?.kind === "StorageQuotaExceeded"
      ? "Not enough browser storage to save this session. Free up space (e.g. delete unused projects) and try again."
      : "Couldn't save the session. Your text is still here — please try again."
    : null;

  const closeDeleteDialog = () => {
    if (isDeleting) return;
    setDeleteTarget(null);
    setDeleteError(null);
  };

  const confirmDelete = async () => {
    if (!deleteTarget || isDeleting) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const ok = await removeLayer(loadedProject.id, deleteTarget.id);
      if (ok) {
        // Deleting the layer currently on screen: fall back to the live view
        // explicitly (the normalization above would too, but an explicit
        // reset keeps mainView from pointing at a dead id).
        if (
          resolvedView.kind === "layer" &&
          resolvedView.layerId === deleteTarget.id
        ) {
          setMainView({ kind: "live" });
        }
        setDeleteTarget(null);
      } else {
        setDeleteError("Couldn't delete the session. Please try again.");
      }
    } finally {
      setIsDeleting(false);
    }
  };

  // Runs the LLM extraction for a brainstorm layer and appends the resulting
  // "decisions" layer via the same awaited addLayer path as a paste. Returns a
  // user-facing error message (the reader surfaces it inline) or null on
  // success.
  const extractDecisions = async (
    layer: ProjectLayer,
  ): Promise<string | null> => {
    const transcript = layer.turns
      .map((turn) => `## ${turn.author}\n\n${turn.content}`)
      .join("\n\n");
    let decisions: string;
    try {
      const res = await fetch("/api/plan/extract-decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript, title: layer.title }),
      });
      const body: unknown = await res.json().catch(() => null);
      const record =
        body && typeof body === "object"
          ? (body as Record<string, unknown>)
          : null;
      if (!res.ok) {
        return typeof record?.error === "string" && record.error
          ? record.error
          : "Couldn't extract decisions. Please try again.";
      }
      if (typeof record?.decisions !== "string" || !record.decisions.trim()) {
        return "The model returned an empty summary. Please try again.";
      }
      decisions = record.decisions;
    } catch {
      return "Couldn't reach the extraction service. Please try again.";
    }

    const layerId = await addLayer(loadedProject.id, {
      kind: "decisions",
      title: `Decisions — ${layer.title}`,
      sourceLayerId: layer.id,
      turns: [
        {
          id: crypto.randomUUID(),
          author: "AI",
          content: decisions,
          at: Date.now(),
        },
      ],
    });
    return layerId === null
      ? "Extracted the summary, but couldn't save it. Please try again."
      : null;
  };

  // ── Composer wiring (right pane, pinned bottom) ───────────────────────────
  const sessionStatus = session.sessionState?.status ?? null;
  const composerMode: "seed" | "steering" | "hidden" =
    resolvedView.kind !== "live"
      ? "hidden"
      : sessionStatus === null
        ? "seed"
        : sessionStatus !== "done"
          ? "steering"
          : "hidden";

  const handleComposerSubmit = async (text: string): Promise<boolean> => {
    if (session.sessionState === null) {
      setStartError(null);
      const started = await session.start(text);
      // Resolving false keeps the draft in the composer (its documented
      // contract) — a failed layer write must never discard the typed brief.
      if (!started) {
        setStartError(
          "Couldn't start the session — the layer could not be saved. Your brief is still here; please try again.",
        );
      }
      return started;
    }
    await session.addSteering(text);
    return true;
  };

  const composer =
    composerMode === "hidden" ? undefined : (
      <div className="shrink-0">
        {composerMode === "seed" && startError && (
          <p role="alert" className="px-4 pt-2 text-sm text-destructive">
            {startError}
          </p>
        )}
        <TextareaComposer
          value={composerDraft}
          onValueChange={setComposerDraft}
          onSubmit={handleComposerSubmit}
          placeholder={
            composerMode === "seed"
              ? "Describe what you want to build (the brief the session starts from)…"
              : "Steer the session (folded into the next model turn)…"
          }
          inputAriaLabel={
            composerMode === "seed" ? "Session brief" : "Steering note"
          }
          submitLabel={composerMode === "seed" ? "Start session" : "Send"}
        />
        {/* ADR-0045 Q5: both live composer modes carry the quota cost. */}
        <p className="px-4 pb-2 text-xs text-muted-foreground">
          Each round uses 2 AI chat requests from your daily quota.
        </p>
      </div>
    );

  // ── Shell footer (locked decision §5 Q2): EMPTY until converged ──────────
  const handleFinalize = () => {
    // Bring the live view forward first: startFinalize streams the distill
    // into the live view's panels, and the user must see it. This is a view
    // switch inside the same screen driven by an explicit click — not an
    // auto-navigation (no router involved).
    setMainView({ kind: "live" });
    void session.startFinalize();
  };

  const showFinalizeAction =
    sessionStatus === "converged" &&
    (session.finalize.phase === "idle" || session.finalize.phase === "error");
  const footer = showFinalizeAction ? (
    // ml-auto: the footer's left side stays empty (locked §5 Q2 — the action
    // sits right, where the wizard's forward action lives).
    <Button className="ml-auto" onClick={handleFinalize}>
      <Sparkles className="w-4 h-4 mr-2" />
      Finalize → Generate manifest
    </Button>
  ) : undefined;

  return (
    <div className="h-full min-h-0 p-4">
      <ProjectsShellWithFreeTier
        title={`Plan — ${loadedProject.name}`}
        footer={footer}
      >
        <PlanWorkbench
          leftTitle="Plan"
          rightTitle="Session"
          settings={
            <ProjectSettingsSection
              projectId={loadedProject.id}
              persist={updateProjectFormState}
            />
          }
          sessions={
            <SessionsSourcesList
              layers={archivedLayers}
              sessionStatus={sessionStatus}
              selectedView={resolvedView}
              onSelectLive={() => setMainView({ kind: "live" })}
              onSelectLayer={(layerId) =>
                setMainView({ kind: "layer", layerId })
              }
            />
          }
          leftFooter={
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => setDialogOpen(true)}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add planning session
            </Button>
          }
          main={
            selectedLayer ? (
              <PlanLayerReader
                // Keyed by layer id so rename-in-progress state can't leak
                // across a row switch in the sessions list.
                key={selectedLayer.id}
                layer={selectedLayer}
                onRename={(title) =>
                  updateLayer(loadedProject.id, selectedLayer.id, { title })
                }
                // Only archived layers ever reach the reader (the active
                // layer normalizes to the live view), so Delete is always
                // offered here — the "no Delete for the session-backed
                // layer" guard is the normalization above.
                onRequestDelete={() => {
                  setDeleteError(null);
                  setDeleteTarget(selectedLayer);
                }}
                onExtractDecisions={
                  selectedLayer.kind === "brainstorm"
                    ? () => extractDecisions(selectedLayer)
                    : undefined
                }
                onSwitchToArchitecture={onSwitchToArchitecture}
              />
            ) : (
              <LiveSessionSection
                projectId={loadedProject.id}
                layers={layers}
                session={session}
                onNavigateToImport={onNavigateToImport}
              />
            )
          }
          composer={composer}
        />
      </ProjectsShellWithFreeTier>

      <AddPlanningSessionDialog
        open={dialogOpen}
        onClose={closeDialog}
        onSubmit={handleSubmit}
        submitError={submitError}
      />

      {/* Delete-confirm stays a Dialog (jsdom's <dialog> a11y-excludes its
          subtree, which the suite works around with prototype stubs). */}
      <Dialog
        open={deleteTarget !== null}
        onClose={closeDeleteDialog}
        dismissible={!isDeleting}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete planning session?</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `"${deleteTarget.title}" and its ${deleteTarget.turns.length} ${
                    deleteTarget.turns.length === 1 ? "turn" : "turns"
                  } will be removed from this project. This cannot be undone.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p role="alert" className="text-sm text-destructive">
              {deleteError}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={closeDeleteDialog}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmDelete()}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting…" : "Delete session"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
