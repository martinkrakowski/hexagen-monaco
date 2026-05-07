"use client";

import { ProjectCard } from "@/components/saved-projects";
import { useSavedProjectsOverlay } from "@/hooks/useSavedProjectsOverlay";
import type { SavedProject } from "@/hooks/useSavedProjects";
import { EmptyProjectsHero } from "./EmptyProjectsHero";

interface ProjectCardGridProps {
  projects: SavedProject[];
  onLoadProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  onRenameProject: (id: string, newName: string) => void;
  onOpenWelcomeDialog: () => void;
  onImportManifest: () => void;
  onStartWizard: () => void;
}

export function ProjectCardGrid({
  projects,
  onLoadProject,
  onDeleteProject,
  onRenameProject,
  onOpenWelcomeDialog,
  onImportManifest,
  onStartWizard,
}: ProjectCardGridProps) {
  const {
    overlay,
    startRename,
    updateRenameValue,
    commitRename,
    cancelRename,
    requestDelete,
    close,
  } = useSavedProjectsOverlay();

  if (projects.length === 0) {
    return (
      <EmptyProjectsHero
        onOpenWelcomeDialog={onOpenWelcomeDialog}
        onImportManifest={onImportManifest}
        onStartWizard={onStartWizard}
      />
    );
  }

  const handleCommitRename = (id: string) => {
    if (overlay.kind === "rename" && overlay.value.trim()) {
      onRenameProject(id, overlay.value.trim());
    }
    commitRename();
  };

  const handleConfirmDelete = (id: string) => {
    onDeleteProject(id);
    close();
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {projects.map((project) => {
        const isRenaming =
          overlay.kind === "rename" && overlay.id === project.id;
        const renameValue =
          overlay.kind === "rename" && overlay.id === project.id
            ? overlay.value
            : project.name;
        const isConfirmingDelete =
          overlay.kind === "delete" && overlay.id === project.id;

        return (
          <ProjectCard
            key={project.id}
            project={project}
            isLoaded={false}
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
            isConfirmingLoad={false}
            onRequestLoad={() => onLoadProject(project.id)}
            onConfirmLoadWithDraft={() => onLoadProject(project.id)}
            onCancelLoadWithDraft={close}
          />
        );
      })}
    </div>
  );
}
