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
import { NotebookPen, Plus } from "lucide-react";
import type { ProjectLayer } from "@hexagen/shared";
import { useWizardLifecycleContext } from "../contexts/WizardLifecycleContext";
import { PlanLayerCard } from "./PlanLayerCard";
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
 * The "Plan" phase of the saved-project workspace: renders the project's
 * planning layers (the brainstorm sessions that produced the manifest), the
 * "Add planning session" ingestion flow, and the LIVE brainstorm session
 * (Phase 3).
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
    layersPersistError,
    clearLayersPersistError,
  } = useWizardLifecycleContext();
  const [dialogOpen, setDialogOpen] = useState(false);
  // persistError is instance-wide (any saved-projects write can set it, e.g. a
  // failed wizard autosave). Show it in the dialog only after a submit from
  // THIS dialog actually failed — never a stale error from an earlier,
  // unrelated write.
  const [submitFailed, setSubmitFailed] = useState(false);
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [deleteTarget, setDeleteTarget] = useState<ProjectLayer | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const layers = loadedProject?.layers;
  // Ordered by creation time; Array.prototype.sort is stable, so layers created
  // in the same millisecond (e.g. batch import) keep their stored order.
  const orderedLayers = useMemo(
    () => (layers ? [...layers].sort((a, b) => a.createdAt - b.createdAt) : []),
    [layers],
  );

  // The live-session loop is owned HERE (single hook instance) so the active
  // session's layer can be filtered out of the archive list below — otherwise
  // its turns would render twice (live panel + archive).
  const session = usePlanningSession({
    projectId: loadedProject?.id ?? null,
    addLayer,
    appendLayerTurn,
    updateLayer,
  });

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

  // The active live-session layer renders in the live panel above the
  // archive — filter it out here so its turns don't appear twice.
  const archivedLayers = orderedLayers.filter(
    (l) => l.id !== session.activeLayerId,
  );

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

  const toggleCollapsed = (layerId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(layerId)) next.delete(layerId);
      else next.add(layerId);
      return next;
    });
  };

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
  // user-facing error message (the card surfaces it inline) or null on success.
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

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Plan</h1>
            <p className="text-sm text-muted-foreground">
              The planning sessions behind{" "}
              <span className="font-medium">{loadedProject.name}</span>.
            </p>
          </div>
          {orderedLayers.length > 0 && (
            <Button variant="secondary" onClick={() => setDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add planning session
            </Button>
          )}
        </div>

        <LiveSessionSection
          projectId={loadedProject.id}
          layers={orderedLayers}
          session={session}
          onNavigateToImport={onNavigateToImport}
        />

        {orderedLayers.length === 0 ? (
          <div className="border border-dashed border-border rounded-lg p-10 text-center space-y-3">
            <NotebookPen className="w-8 h-8 mx-auto text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">
              No planning session yet
            </p>
            <p className="text-sm text-muted-foreground">
              Add the brainstorm that produced this architecture — pasted
              markdown or a .md file — and it lives here, next to the manifest
              it became.
            </p>
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add planning session
            </Button>
          </div>
        ) : (
          archivedLayers.map((layer) => (
            <PlanLayerCard
              key={layer.id}
              layer={layer}
              collapsed={collapsedIds.has(layer.id)}
              onToggleCollapsed={() => toggleCollapsed(layer.id)}
              onRename={(title) =>
                updateLayer(loadedProject.id, layer.id, { title })
              }
              onRequestDelete={() => {
                setDeleteError(null);
                setDeleteTarget(layer);
              }}
              onExtractDecisions={
                layer.kind === "brainstorm"
                  ? () => extractDecisions(layer)
                  : undefined
              }
              onSwitchToArchitecture={onSwitchToArchitecture}
            />
          ))
        )}
      </div>

      <AddPlanningSessionDialog
        open={dialogOpen}
        onClose={closeDialog}
        onSubmit={handleSubmit}
        submitError={submitError}
      />

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
