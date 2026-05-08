"use client";

import { useMemo, useCallback } from "react";
import type { SavedProject } from "@/hooks/useSavedProjects";
import { toProjectListItem, sortItems } from "./domain/project-list";
import { useProjectTable } from "./application/useProjectTable";
import { ProjectsTable } from "./components/ProjectsTable";
import { ProjectsEmptyState } from "./components/ProjectsEmptyState";
import { BulkActionsBar } from "./components/BulkActionsBar";
import { DeleteProjectDialog } from "./components/DeleteProjectDialog";
import { ProjectToast } from "./components/ProjectToast";

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
  const {
    sort,
    toggleSort,
    selection,
    relativeTime,
    shortDate,
    overlay,
    toast,
    handleCommitRename,
    handleConfirmDelete,
    handleDeleteSelected,
    handleStartRename,
  } = useProjectTable(projects, onDeleteProject, onRenameProject);

  const items = useMemo(
    () => sortItems(projects.map(toProjectListItem), sort),
    [projects, sort],
  );

  const deleteTargetId =
    overlay.overlay.kind === "delete" ? overlay.overlay.id : "";
  const deleteTargetName = useCallback((): string => {
    if (!deleteTargetId) return "";
    const project = projects.find((p) => p.id === deleteTargetId);
    return project?.name ?? "";
  }, [deleteTargetId, projects]);

  return (
    <>
      {items.length === 0 ? (
        <ProjectsEmptyState />
      ) : (
        <>
          <ProjectsTable
            items={items}
            sort={sort}
            onToggleSort={toggleSort}
            isSelected={selection.isSelected}
            allSelected={selection.allSelected}
            onToggleSelect={selection.toggle}
            onToggleAll={selection.toggleAll}
            onLoadProject={onLoadProject}
            onRequestRename={handleStartRename}
            onRequestDelete={overlay.requestDelete}
            relativeTime={relativeTime}
            shortDate={shortDate}
            renameOverlay={
              overlay.overlay.kind === "rename" ? overlay.overlay : null
            }
            onUpdateRenameValue={overlay.updateRenameValue}
            onCommitRename={handleCommitRename}
            onCancelRename={overlay.cancelRename}
          />

          <BulkActionsBar
            selectedCount={selection.count}
            onDeleteSelected={handleDeleteSelected}
            onClearSelection={selection.clearSelection}
          />

          <DeleteProjectDialog
            open={overlay.overlay.kind === "delete"}
            onClose={overlay.close}
            onConfirm={() => {
              if (deleteTargetId) {
                handleConfirmDelete(deleteTargetId);
              }
            }}
            projectName={deleteTargetName()}
          />
        </>
      )}

      <ProjectToast
        message={toast.message}
        type={toast.type}
        visible={toast.visible}
      />
    </>
  );
}
