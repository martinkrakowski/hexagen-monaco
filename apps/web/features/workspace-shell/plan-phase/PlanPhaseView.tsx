"use client";

import { useState } from "react";
import { Button } from "@hexagen/ui";
import { NotebookPen, Plus } from "lucide-react";
import { useWizardLifecycleContext } from "../contexts/WizardLifecycleContext";
import { PlanTurnList } from "./PlanTurnList";
import { AddPlanningSessionDialog } from "./AddPlanningSessionDialog";
import { LiveSessionSection } from "./LiveSessionSection";
import { usePlanningSession } from "./session/usePlanningSession";
import type { NewProjectLayer } from "@/hooks/useSavedProjects";

export interface PlanPhaseViewProps {
  /** Prop-injected navigation to the spec-import flow (finalize hand-off) —
   * repo convention: no router coupling, no auto-navigate outside an explicit
   * user confirm. */
  onNavigateToImport: () => void;
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
export function PlanPhaseView({ onNavigateToImport }: PlanPhaseViewProps) {
  const {
    loadedProject,
    addLayer,
    updateLayer,
    appendLayerTurn,
    layersPersistError,
    clearLayersPersistError,
  } = useWizardLifecycleContext();
  const [dialogOpen, setDialogOpen] = useState(false);
  // persistError is instance-wide (any saved-projects write can set it, e.g. a
  // failed wizard autosave). Show it in the dialog only after a submit from
  // THIS dialog actually failed — never a stale error from an earlier,
  // unrelated write.
  const [submitFailed, setSubmitFailed] = useState(false);

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

  const layers = loadedProject.layers;
  const archivedLayers = layers.filter((l) => l.id !== session.activeLayerId);

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
          {layers.length > 0 && (
            <Button variant="secondary" onClick={() => setDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add planning session
            </Button>
          )}
        </div>

        <LiveSessionSection
          projectId={loadedProject.id}
          layers={layers}
          session={session}
          onNavigateToImport={onNavigateToImport}
        />

        {layers.length === 0 ? (
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
            <section key={layer.id} className="space-y-3">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold text-foreground">
                  {layer.title}
                </h2>
                <span className="text-xs text-muted-foreground">
                  {layer.turns.length}{" "}
                  {layer.turns.length === 1 ? "turn" : "turns"}
                </span>
              </div>
              <PlanTurnList turns={layer.turns} />
            </section>
          ))
        )}
      </div>

      <AddPlanningSessionDialog
        open={dialogOpen}
        onClose={closeDialog}
        onSubmit={handleSubmit}
        submitError={submitError}
      />
    </div>
  );
}
