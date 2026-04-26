"use client";

import { Trash2 } from "lucide-react";
import type { SavedProject } from "@/hooks/useSavedProjects";

const MAX_PROJECTS_IN_MENU = 5;

interface SavedProjectsSubmenuProps {
  open: boolean;
  projects: SavedProject[];
  onSelect: (project: SavedProject) => void;
  onDelete: (id: string) => void;
}

/**
 * Flyout submenu listing saved projects. Controlled by the parent's
 * hover/focus state — no internal open state.
 */
export function SavedProjectsSubmenu({
  open,
  projects,
  onSelect,
  onDelete,
}: SavedProjectsSubmenuProps) {
  if (!open) return null;

  return (
    <div
      role="menu"
      className="absolute left-full top-0 ml-0 w-56 bg-card border border-border rounded-md shadow-lg py-1 z-50"
    >
      {projects.length === 0 ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">
          No saved projects
        </p>
      ) : (
        projects.slice(0, MAX_PROJECTS_IN_MENU).map((project) => (
          <div
            key={project.id}
            className="flex items-center justify-between px-3 py-2 text-sm hover:bg-muted"
          >
            <button
              type="button"
              onClick={() => onSelect(project)}
              className="flex-1 truncate text-left"
            >
              {project.name}
            </button>
            <button
              type="button"
              aria-label={`Delete ${project.name}`}
              onClick={(event) => {
                event.stopPropagation();
                onDelete(project.id);
              }}
              className="p-1 hover:bg-destructive/20 rounded"
            >
              <Trash2 className="w-3 h-3 text-destructive" />
            </button>
          </div>
        ))
      )}
    </div>
  );
}
