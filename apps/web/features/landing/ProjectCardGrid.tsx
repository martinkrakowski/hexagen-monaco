"use client";

import Link from "next/link";
import { ProjectCard } from "@/components/saved-projects";
import { useSavedProjectsOverlay } from "@/hooks/useSavedProjectsOverlay";
import type { SavedProject } from "@/hooks/useSavedProjects";

interface ProjectCardGridProps {
  projects: SavedProject[];
  onLoadProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  onRenameProject: (id: string, newName: string) => void;
}

function EmptyState() {
  return (
    <div className="text-center py-12">
      <p className="text-muted-foreground mb-4">No projects yet.</p>
      <Link href="/projects/new" className="text-primary hover:underline">
        Create a new project
      </Link>
    </div>
  );
}

export function ProjectCardGrid({
  projects,
  onLoadProject,
  onDeleteProject,
  onRenameProject,
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
    return <EmptyState />;
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
            onRequestLoad={() => onLoadProject(project.id)}
          />
        );
      })}
    </div>
  );
}
