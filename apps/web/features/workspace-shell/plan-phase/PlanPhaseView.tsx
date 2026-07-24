"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
import {
  AddPlanningSessionView,
  EMPTY_ADD_SESSION_DRAFT,
  type AddSessionDraft,
} from "./AddPlanningSessionView";
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
 * (Plan Workbench A2/B): this component is the WIRING HOST — it owns every
 * context read (wizard lifecycle), the single usePlanningSession instance,
 * the right-pane view selection (the `?layer=` URL param + the transient
 * add-session overlay), and the shared composer draft, and feeds the purely
 * presentational PlanWorkbench through adapter props.
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
  // The add-session view (plan req 4b) is TRANSIENT local state layered over
  // the URL-derived view: it is never persisted to `?layer=`, so leaving it
  // (Cancel, row click, success) restores whatever the URL says.
  const [isAddingSession, setIsAddingSession] = useState(false);
  // The add-session DRAFT is lifted here for the same reason as composerDraft
  // below: the view is conditionally rendered, so a host-level leave (a
  // sessions-row click) unmounts it mid-edit — and a pasted transcript is
  // hard to reconstruct. The old always-mounted dialog kept this state alive
  // structurally; the inline view gets it from the host. Only a successful
  // submit resets it.
  const [addSessionDraft, setAddSessionDraft] = useState<AddSessionDraft>(
    EMPTY_ADD_SESSION_DRAFT,
  );
  // True while an add-session submit's addLayer write is in flight — the port
  // of the old dialog's `dismissible={!isSubmitting}` gate: the leave paths
  // below ignore row clicks mid-write, so the form can't be unmounted between
  // submit and resolution (and the success arm can't yank a selection the
  // user just made out from under them).
  const [isAddSubmitting, setIsAddSubmitting] = useState(false);
  // persistError is instance-wide (any saved-projects write can set it, e.g. a
  // failed wizard autosave). Show it in the add-session view only after a
  // submit from THIS view actually failed — never a stale error from an
  // earlier, unrelated write.
  const [submitFailed, setSubmitFailed] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectLayer | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // ONE shared composer draft, lifted to the host: the composer unmounts on a
  // view switch (and on the mobile tab switch), and typed text must survive.
  const [composerDraft, setComposerDraft] = useState("");
  const [startError, setStartError] = useState<string | null>(null);

  // ── `?layer=` selection (PR B) ─────────────────────────────────────────────
  // Subscribed HERE, inside the plan host — never threaded through
  // ProjectWorkspaceLayout props: its React.memo comparator hand-picks props
  // (documented trap at DerivedFromPlanLink.tsx:14-19) and would swallow
  // updates. useSearchParams re-renders this component directly.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Snapshot as a string: stable across renders while the URL is unchanged,
  // so the callbacks/effects below don't re-mint on the params OBJECT.
  const search = searchParams.toString();
  const layerParam = searchParams.get("layer");

  /**
   * Rewrite only the `layer` param (null clears it), preserving every other
   * param (`project`, `phase`, `view`…) — always via router.REPLACE: selection
   * is view state, and push would spray one history entry per row click.
   */
  const replaceLayerParam = useCallback(
    (layerId: string | null) => {
      const params = new URLSearchParams(search);
      if (layerId === null) params.delete("layer");
      else params.set("layer", layerId);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    },
    [search, router, pathname],
  );

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

  // View-union guards on the URL-derived selection: the active session's
  // layer always normalizes to the live view (its turns must never render
  // twice — this is also the delete guard: the reader, and its Delete
  // affordance, are unreachable for the session-backed layer even via a deep
  // link), and an unknown/deleted id falls back to live instead of a blank
  // pane.
  const urlView: WorkbenchMainView = useMemo(() => {
    if (layerParam !== null) {
      if (
        layerParam !== session.activeLayerId &&
        layers.some((l) => l.id === layerParam)
      ) {
        return { kind: "layer", layerId: layerParam };
      }
    }
    return { kind: "live" };
  }, [layerParam, session.activeLayerId, layers]);

  // When the param normalized away (unknown/deleted id, or the active
  // session's layer id), clean the URL too — via replace, so the dead link
  // doesn't linger in the address bar or get copied onward.
  const hasProject = loadedProject !== null && loadedProject !== undefined;
  useEffect(() => {
    if (!hasProject) return;
    if (layerParam === null) return;
    if (urlView.kind === "layer") return;
    replaceLayerParam(null);
  }, [hasProject, layerParam, urlView.kind, replaceLayerParam]);

  // The transient add-session view sits ON TOP of the URL-derived view.
  const resolvedView: WorkbenchMainView = isAddingSession
    ? { kind: "add-session" }
    : urlView;

  /**
   * Row/footer selection — leaves the transient add-session view first.
   * Both selectors are no-ops while an add-session submit is in flight (the
   * old dialog's `dismissible={!isSubmitting}`, ported), and both clear a
   * previous submit's failure flag: a row click is a deliberate exit from
   * the add-session view, and reopening it later must not show a stale
   * "couldn't save" alert from one view instance ago (only Cancel did this
   * before — the row-click exit leaked it).
   */
  const selectLive = useCallback(() => {
    if (isAddSubmitting) return;
    setIsAddingSession(false);
    setSubmitFailed(false);
    if (layerParam !== null) replaceLayerParam(null);
  }, [isAddSubmitting, layerParam, replaceLayerParam]);

  const selectLayer = useCallback(
    (layerId: string) => {
      if (isAddSubmitting) return;
      setIsAddingSession(false);
      setSubmitFailed(false);
      if (layerParam !== layerId) replaceLayerParam(layerId);
    },
    [isAddSubmitting, layerParam, replaceLayerParam],
  );

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
    setIsAddSubmitting(true);
    try {
      const layerId = await addLayer(loadedProject.id, layer);
      if (layerId === null) {
        setSubmitFailed(true);
        return false;
      }
      // Success: leave the transient add-session view and select the freshly
      // created layer's reader (plan §3.3 — "On success: select the new
      // layer"). replace, not push — same-screen view selection, and this arm
      // lands on the reader, not a navigation target.
      setIsAddingSession(false);
      replaceLayerParam(layerId);
      return true;
    } finally {
      setIsAddSubmitting(false);
    }
  };

  const openAddSession = () => setIsAddingSession(true);

  const closeAddSession = () => {
    // Cancel: drop the overlay — the URL-derived view (live or the previously
    // selected layer) is untouched underneath and simply shows again. The
    // DRAFT deliberately survives (as it did in the always-mounted dialog):
    // an accidental dismiss must never cost a pasted transcript.
    setIsAddingSession(false);
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
        // explicitly (the URL-cleanup effect would too, but an explicit
        // replace keeps ?layer= from transiently pointing at a dead id).
        if (
          resolvedView.kind === "layer" &&
          resolvedView.layerId === deleteTarget.id
        ) {
          selectLive();
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
    // Propagate the persist outcome: false keeps the draft in the composer
    // (its documented contract), mirroring the seed branch above.
    return session.addSteering(text);
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
    // switch inside the same screen driven by an explicit click — the
    // router.replace inside selectLive only rewrites ?layer=, never the
    // route (no auto-navigation).
    selectLive();
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
              onSelectLive={selectLive}
              onSelectLayer={selectLayer}
            />
          }
          leftFooter={
            // Selects the inline add-session view (req 4b — the modal is
            // gone). Same slot renders as the mobile fixed footer below both
            // tabs, so this one handler covers both form factors.
            <Button
              variant="secondary"
              className="w-full"
              onClick={openAddSession}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add planning session
            </Button>
          }
          main={
            resolvedView.kind === "add-session" ? (
              <AddPlanningSessionView
                onCancel={closeAddSession}
                onSubmit={handleSubmit}
                submitError={submitError}
                draft={addSessionDraft}
                onDraftChange={setAddSessionDraft}
              />
            ) : selectedLayer ? (
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
                onAddSession={openAddSession}
              />
            )
          }
          composer={composer}
        />
      </ProjectsShellWithFreeTier>

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
