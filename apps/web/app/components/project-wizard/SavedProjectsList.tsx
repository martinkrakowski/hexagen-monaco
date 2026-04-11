"use client";

import { useState } from "react";
import { AlertTriangle, FolderOpen, Pencil, Trash2 } from "lucide-react";
import type { SavedProject } from "@/hooks/use-saved-projects";

interface SavedProjectsListProps {
  projects: SavedProject[];
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, newName: string) => void;
  onBackToWizard: () => void;
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export function SavedProjectsList({
  projects,
  onLoad,
  onDelete,
  onRename,
  onBackToWizard,
}: SavedProjectsListProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleStartRename = (project: SavedProject) => {
    setRenamingId(project.id);
    setRenameValue(project.name);
  };

  const handleSaveRename = (id: string) => {
    if (renameValue.trim()) {
      onRename(id, renameValue.trim());
    }
    setRenamingId(null);
    setRenameValue("");
  };

  const handleCancelRename = () => {
    setRenamingId(null);
    setRenameValue("");
  };

  const handleDeleteConfirm = (id: string) => {
    onDelete(id);
    setDeletingId(null);
  };

  return (
    <div className="flex flex-col h-full bg-card overflow-hidden">
      <div className="flex-shrink-0 p-6 pb-4">
        <h2 className="text-2xl font-semibold mb-2">Previous Projects</h2>
        <p className="text-muted-foreground text-sm">
          Load, rename, or delete your saved projects.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {projects.length === 0 ? (
          <div className="text-center py-12">
            <FolderOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No saved projects yet.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Generate a project to save it here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {projects.map((project) => (
              <div
                key={project.id}
                className="relative p-4 border border-border rounded-lg bg-background"
              >
                {deletingId === project.id ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/95 backdrop-blur-sm rounded-lg gap-2">
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                    <span className="text-xs font-medium text-destructive">
                      Delete?
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDeleteConfirm(project.id)}
                      className="px-2 py-1 text-xs font-medium text-white bg-destructive rounded hover:bg-destructive/90"
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletingId(null)}
                      className="px-2 py-1 text-xs font-medium text-foreground bg-muted rounded hover:bg-muted"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        {renamingId === project.id ? (
                          <input
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter")
                                handleSaveRename(project.id);
                              if (e.key === "Escape") handleCancelRename();
                            }}
                            className="w-full px-2 py-1 bg-muted border border-input rounded text-sm text-foreground outline-none"
                            autoFocus
                          />
                        ) : (
                          <h3 className="font-medium text-foreground truncate">
                            {project.name}
                          </h3>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          {project.formState.governance?.workspaceName ||
                            project.formState.workspaceScope}
                        </p>
                      </div>
                    </div>
                    <div className="text-[10px] text-muted-foreground mb-3">
                      Created: {formatDate(project.createdAt)}
                      {project.updatedAt !== project.createdAt &&
                        ` • Updated: ${formatDate(project.updatedAt)}`}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onLoad(project.id)}
                        className="px-3 py-1.5 text-xs font-bold text-primary-foreground bg-primary hover:bg-primary/90 rounded-md transition-colors"
                      >
                        Load
                      </button>
                      <button
                        type="button"
                        onClick={() => handleStartRename(project)}
                        className="px-3 py-1.5 text-xs font-medium text-muted-foreground bg-muted hover:bg-muted/80 rounded-md transition-colors border border-input flex items-center gap-1"
                      >
                        <Pencil className="h-3 w-3" />
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingId(project.id)}
                        className="px-3 py-1.5 text-xs font-medium text-destructive bg-muted hover:bg-destructive/10 rounded-md transition-colors border border-input flex items-center gap-1 ml-auto"
                      >
                        <Trash2 className="h-3 w-3" />
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <footer className="flex-shrink-0 bg-background border-t border-border p-4 flex justify-between items-center z-10">
        <button
          type="button"
          onClick={onBackToWizard}
          className="px-6 py-2 text-sm font-medium text-foreground bg-muted hover:bg-muted rounded-md transition-colors border border-input"
        >
          Back to Wizard
        </button>
      </footer>
    </div>
  );
}
