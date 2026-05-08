"use client";

import { useMemo, useCallback } from "react";
import type { SavedProject } from "@/hooks/useSavedProjects";
import { toProjectListItem, sortItems } from "./domain/project-list";
import { useProjectSort } from "./application/useProjectSort";
import { useProjectSelection } from "./application/useProjectSelection";
import { useRelativeTime } from "./application/useRelativeTime";
import { ProjectsTable } from "./components/ProjectsTable";
import { ProjectsEmptyState } from "./components/ProjectsEmptyState";

interface ProjectCardGridProps {
  projects: SavedProject[];
  onLoadProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  onRenameProject: (id: string, newName: string) => void;
}

export function ProjectCardGrid({
  projects,
  onLoadProject,
  onDeleteProject,
  onRenameProject,
}: ProjectCardGridProps) {
  const { sort, toggleSort } = useProjectSort();
  const { isSelected, toggle, toggleAll, allSelected } = useProjectSelection();
  const { relativeTime, shortDate } = useRelativeTime();

  const items = useMemo(
    () => sortItems(projects.map(toProjectListItem), sort),
    [projects, sort],
  );

  const handleRequestRename = useCallback(
    (id: string) => {
      const project = projects.find((p) => p.id === id);
      if (project) onRenameProject(id, project.name);
    },
    [projects, onRenameProject],
  );

  if (items.length === 0) {
    return <ProjectsEmptyState />;
  }

  return (
    <ProjectsTable
      items={items}
      sort={sort}
      onToggleSort={toggleSort}
      isSelected={isSelected}
      allSelected={allSelected}
      onToggleSelect={toggle}
      onToggleAll={toggleAll}
      onLoadProject={onLoadProject}
      onRequestRename={handleRequestRename}
      onRequestDelete={onDeleteProject}
      relativeTime={relativeTime}
      shortDate={shortDate}
    />
  );
}
