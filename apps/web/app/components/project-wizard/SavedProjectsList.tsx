"use client";

import { PrimaryButton } from "@/components/ui/PrimaryButton";
import type { SavedProject } from "@/hooks/useSavedProjects";
import { useSavedProjectsOverlay } from "@/hooks/useSavedProjectsOverlay";
import type { WizardDraft } from "@hexagen/shared";

import { DraftCard, ProjectCard, ProjectsEmptyState } from "./saved-projects";

interface SavedProjectsListProps {
  projects: SavedProject[];
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, newName: string) => void;
  onBackToWizard: () => void;
  draft?: WizardDraft | null;
  onResumeDraft?: () => void;
  onDiscardDraft?: () => void;
  loadedProjectId?: string | null;
}

/**
 * Saved-projects management screen. Lists saved projects with
 * load/rename/delete actions and surfaces any in-progress draft
 * for resume/discard. All overlay state (rename, delete-confirm,
 * discard-draft, load-with-draft) is held in a single discriminated
 * union via useSavedProjectsOverlay.
 */
export function SavedProjectsList({
  projects,
  onLoad,
  onDelete,
  onRename,
  onBackToWizard,
  draft,
  onResumeDraft,
  onDiscardDraft,
  loadedProjectId,
}: SavedProjectsListProps) {
  const {
    overlay,
    startRename,
    updateRenameValue,
    commitRename,
    cancelRename,
    requestDelete,
    requestDiscardDraft,
    requestLoadWithDraft,
    close,
  } = useSavedProjectsOverlay();

  const handleLoadClick = (id: string) => {
    if (draft) {
      requestLoadWithDraft(id);
    } else {
      onLoad(id);
    }
  };

  const handleCommitRename = (id: string) => {
    if (overlay.kind === "rename" && overlay.value.trim()) {
      onRename(id, overlay.value.trim());
    }
    commitRename();
  };

  const handleConfirmDiscardDraft = () => {
    close();
    onDiscardDraft?.();
  };

  const handleConfirmLoadWithDraft = (id: string) => {
    close();
    onLoad(id);
  };

  const handleConfirmDelete = (id: string) => {
    onDelete(id);
    close();
  };

  const hasProjects = projects && projects.length > 0;

  return (
    <div className="flex flex-col h-full bg-card overflow-hidden">
      <div className="flex-shrink-0 p-6 pb-4">
        <h2 className="text-2xl font-semibold mb-2">Previous Projects</h2>
        <p className="text-muted-foreground text-sm">
          Load, rename, or delete your saved projects.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {!hasProjects && !draft ? (
          <ProjectsEmptyState />
        ) : (
          <div className="space-y-3">
            {draft && (
              <DraftCard
                draft={draft}
                isConfirmingDiscard={overlay.kind === "discard-draft"}
                onResume={() => onResumeDraft?.()}
                onRequestDiscard={requestDiscardDraft}
                onConfirmDiscard={handleConfirmDiscardDraft}
                onCancelDiscard={close}
              />
            )}

            {projects.map((project) => {
              const isRenaming =
                overlay.kind === "rename" && overlay.id === project.id;
              const renameValue =
                overlay.kind === "rename" && overlay.id === project.id
                  ? overlay.value
                  : project.name;
              const isConfirmingDelete =
                overlay.kind === "delete" && overlay.id === project.id;
              const isConfirmingLoad =
                overlay.kind === "load-with-draft" && overlay.id === project.id;

              return (
                <ProjectCard
                  key={project.id}
                  project={project}
                  isLoaded={loadedProjectId === project.id}
                  isRenaming={isRenaming}
                  renameValue={renameValue}
                  onChangeRenameValue={updateRenameValue}
                  onStartRename={() => startRename(project.id, project.name)}
                  onCommitRename={() => handleCommitRename(project.id)}
                  onCancelRename={cancelRename}
                  isConfirmingDelete={isConfirmingDelete}
                  onRequestDelete={() => requestDelete(project.id)}
                  onConfirmDelete={() => handleConfirmDelete(project.id)}
                  onCancelDelete={close}
                  isConfirmingLoad={isConfirmingLoad}
                  onRequestLoad={() => handleLoadClick(project.id)}
                  onConfirmLoadWithDraft={() =>
                    handleConfirmLoadWithDraft(project.id)
                  }
                  onCancelLoadWithDraft={close}
                />
              );
            })}
          </div>
        )}
      </div>

      <footer className="flex-shrink-0 bg-background border-t border-border p-4 flex justify-between items-center z-10">
        <PrimaryButton variant="outline" onClick={onBackToWizard}>
          Back to Wizard
        </PrimaryButton>
      </footer>
    </div>
  );
}
