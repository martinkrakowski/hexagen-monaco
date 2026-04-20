"use client";

import { AlertTriangle, Pencil, Trash2 } from "lucide-react";
import { Button } from "@hexagen/ui";
import type { SavedProject } from "@/hooks/useSavedProjects";

import { formatDate } from "./format-date";

interface ProjectCardProps {
  project: SavedProject;
  isLoaded: boolean;

  // Rename state (controlled — overlay state machine lives in parent)
  isRenaming: boolean;
  renameValue: string;
  onChangeRenameValue: (value: string) => void;
  onStartRename: () => void;
  onCommitRename: () => void;
  onCancelRename: () => void;

  // Delete-confirm overlay
  isConfirmingDelete: boolean;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;

  // Load-with-draft overlay
  isConfirmingLoad: boolean;
  onRequestLoad: () => void;
  onConfirmLoadWithDraft: () => void;
  onCancelLoadWithDraft: () => void;
}

/**
 * Single saved-project row. Supports three mutually-exclusive
 * overlays (rename input, delete-confirm, load-with-draft-confirm)
 * plus a muted "Editing" indicator when the project is the one
 * currently loaded in the workspace.
 *
 * All overlay state is controlled from the parent (via
 * useSavedProjectsOverlay) — the card is stateless.
 */
export function ProjectCard({
  project,
  isLoaded,
  isRenaming,
  renameValue,
  onChangeRenameValue,
  onStartRename,
  onCommitRename,
  onCancelRename,
  isConfirmingDelete,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  isConfirmingLoad,
  onRequestLoad,
  onConfirmLoadWithDraft,
  onCancelLoadWithDraft,
}: ProjectCardProps) {
  const hasOverlay = isConfirmingDelete || isConfirmingLoad;

  return (
    <div className="relative p-4 border border-border rounded-lg bg-background">
      {isConfirmingDelete && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/95 backdrop-blur-sm rounded-lg gap-2">
          <AlertTriangle
            aria-hidden="true"
            className="h-4 w-4 text-destructive"
          />
          <span className="text-xs font-medium text-destructive">Delete?</span>
          <Button
            variant="destructive"
            size="sm"
            onClick={onConfirmDelete}
            className="h-auto px-2 py-1 text-xs"
          >
            Yes
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onCancelDelete}
            className="h-auto px-2 py-1 text-xs"
          >
            No
          </Button>
        </div>
      )}

      {isConfirmingLoad && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/95 backdrop-blur-sm rounded-lg gap-3 p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle
              aria-hidden="true"
              className="h-4 w-4 text-yellow-500 shrink-0"
            />
            <span className="text-xs font-medium text-foreground">
              Load this project?
            </span>
          </div>
          <p className="text-xs text-muted-foreground text-center">
            Your unsaved draft will be permanently lost.
          </p>
          <div className="flex gap-2">
            <Button
              variant="destructive"
              size="sm"
              onClick={onConfirmLoadWithDraft}
              className="h-auto px-3 py-1 text-xs"
            >
              Load &amp; Discard Draft
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onCancelLoadWithDraft}
              className="h-auto px-3 py-1 text-xs"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className={hasOverlay ? "invisible" : ""}>
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 min-w-0">
            {isRenaming ? (
              <input
                ref={(el) => el?.focus()}
                type="text"
                value={renameValue}
                onChange={(e) => onChangeRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onCommitRename();
                  if (e.key === "Escape") onCancelRename();
                }}
                className="w-full px-2 py-1 bg-muted border border-input rounded text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            ) : (
              <h3 className="font-medium text-foreground truncate">
                {project.name}
              </h3>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              {project.formState.governance?.workspaceName || "Untitled"}
            </p>
          </div>
        </div>

        <div className="text-[10px] text-muted-foreground mb-3">
          Created: {formatDate(project.createdAt)}
          {project.updatedAt !== project.createdAt &&
            ` • Updated: ${formatDate(project.updatedAt)}`}
        </div>

        <div className="flex items-center gap-2">
          {isLoaded ? (
            <span className="text-xs font-medium text-muted-foreground px-2 py-1">
              Editing
            </span>
          ) : (
            <Button
              size="sm"
              onClick={onRequestLoad}
              className="h-auto px-3 py-1.5 text-xs"
            >
              Load
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={onStartRename}
            className="h-auto px-3 py-1.5 text-xs"
          >
            <Pencil aria-hidden="true" className="h-3 w-3 mr-1" />
            Rename
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onRequestDelete}
            className="h-auto px-3 py-1.5 text-xs text-destructive hover:text-destructive ml-auto"
          >
            <Trash2 aria-hidden="true" className="h-3 w-3 mr-1" />
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
