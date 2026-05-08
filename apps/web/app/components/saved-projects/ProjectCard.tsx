"use client";

import { AlertTriangle, Pencil, Trash2 } from "lucide-react";
import { Button, Card, CardHeader, CardTitle, CardContent } from "@hexagen/ui";
import type { SavedProject } from "@/hooks/useSavedProjects";

import { formatDate } from "./format-date";

interface ProjectCardProps {
  project: SavedProject;
  isLoaded: boolean;
  isRenaming: boolean;
  renameValue: string;
  onChangeRenameValue: (value: string) => void;
  onStartRename: () => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  isConfirmingDelete: boolean;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onRequestLoad: () => void;
}

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
  onRequestLoad,
}: ProjectCardProps) {
  return (
    <Card className="relative bg-background shadow-none">
      {isConfirmingDelete && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/95 backdrop-blur-sm rounded-md gap-2">
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

      <div className={isConfirmingDelete ? "invisible" : ""}>
        <CardHeader>
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
              <CardTitle className="truncate">{project.name}</CardTitle>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              {project.formState.governance?.workspaceName || "Untitled"}
            </p>
          </div>
        </CardHeader>

        <CardContent>
          <div className="text-xs text-muted-foreground mb-3">
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
        </CardContent>
      </div>
    </Card>
  );
}
