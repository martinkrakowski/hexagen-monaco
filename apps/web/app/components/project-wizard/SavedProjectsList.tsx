"use client";

import { useState } from "react";
import {
  AlertTriangle,
  FolderOpen,
  Pencil,
  Trash2,
  FileEdit,
} from "lucide-react";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import type { SavedProject } from "@/hooks/use-saved-projects";
import type { WizardDraft } from "@hexagen/shared";

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
  draft,
  onResumeDraft,
  onDiscardDraft,
  loadedProjectId,
}: SavedProjectsListProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showDiscardDraft, setShowDiscardDraft] = useState(false);
  const [pendingLoadId, setPendingLoadId] = useState<string | null>(null);

  const handleLoadClick = (id: string) => {
    if (draft) {
      setPendingLoadId(id);
    } else {
      onLoad(id);
    }
  };

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
        {(!projects || projects.length === 0) && !draft ? (
          <div className="text-center py-12">
            <FolderOpen
              aria-hidden="true"
              className="h-12 w-12 mx-auto text-muted-foreground mb-4"
            />
            <p className="text-muted-foreground">No saved projects yet.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Generate a project to save it here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {draft && (
              <div className="relative p-4 border border-yellow-500/50 rounded-lg bg-yellow-500/5">
                {showDiscardDraft ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/95 backdrop-blur-sm rounded-lg gap-2">
                    <AlertTriangle
                      aria-hidden="true"
                      className="h-4 w-4 text-destructive"
                    />
                    <span className="text-xs font-medium text-destructive">
                      Discard Draft?
                    </span>
                    <PrimaryButton
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        setShowDiscardDraft(false);
                        onDiscardDraft?.();
                      }}
                      className="h-auto px-2 py-1 text-xs"
                    >
                      Yes
                    </PrimaryButton>
                    <PrimaryButton
                      variant="outline"
                      size="sm"
                      onClick={() => setShowDiscardDraft(false)}
                      className="h-auto px-2 py-1 text-xs"
                    >
                      No
                    </PrimaryButton>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-500/20 text-yellow-700 dark:text-yellow-300">
                        Draft
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Step {(draft.savedAtStep ?? 0) + 1} of 6
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">
                      Last saved: {formatDate(draft.updatedAt)}
                    </p>
                    <div className="flex items-center gap-2">
                      <PrimaryButton
                        size="sm"
                        onClick={onResumeDraft}
                        className="h-auto px-3 py-1.5 text-xs"
                      >
                        <FileEdit aria-hidden="true" className="h-3 w-3 mr-1" />
                        Resume
                      </PrimaryButton>
                      <PrimaryButton
                        variant="outline"
                        size="sm"
                        onClick={() => setShowDiscardDraft(true)}
                        className="h-auto px-3 py-1.5 text-xs text-destructive hover:text-destructive"
                      >
                        <Trash2 aria-hidden="true" className="h-3 w-3 mr-1" />
                        Discard
                      </PrimaryButton>
                    </div>
                  </>
                )}
              </div>
            )}
            {projects.map((project) => (
              <div
                key={project.id}
                className="relative p-4 border border-border rounded-lg bg-background"
              >
                {deletingId === project.id ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/95 backdrop-blur-sm rounded-lg gap-2">
                    <AlertTriangle
                      aria-hidden="true"
                      className="h-4 w-4 text-destructive"
                    />
                    <span className="text-xs font-medium text-destructive">
                      Delete?
                    </span>
                    <PrimaryButton
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDeleteConfirm(project.id)}
                      className="h-auto px-2 py-1 text-xs"
                    >
                      Yes
                    </PrimaryButton>
                    <PrimaryButton
                      variant="outline"
                      size="sm"
                      onClick={() => setDeletingId(null)}
                      className="h-auto px-2 py-1 text-xs"
                    >
                      No
                    </PrimaryButton>
                  </div>
                ) : pendingLoadId === project.id ? (
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
                      <PrimaryButton
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          const id = pendingLoadId;
                          setPendingLoadId(null);
                          onLoad(id);
                        }}
                        className="h-auto px-3 py-1 text-xs"
                      >
                        Load & Discard Draft
                      </PrimaryButton>
                      <PrimaryButton
                        variant="outline"
                        size="sm"
                        onClick={() => setPendingLoadId(null)}
                        className="h-auto px-3 py-1 text-xs"
                      >
                        Cancel
                      </PrimaryButton>
                    </div>
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
                            className="w-full px-2 py-1 bg-muted border border-input rounded text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                      {loadedProjectId === project.id ? (
                        <span className="text-xs font-medium text-muted-foreground px-2 py-1">
                          Editing
                        </span>
                      ) : (
                        <PrimaryButton
                          size="sm"
                          onClick={() => handleLoadClick(project.id)}
                          className="h-auto px-3 py-1.5 text-xs"
                        >
                          Load
                        </PrimaryButton>
                      )}
                      <PrimaryButton
                        variant="outline"
                        size="sm"
                        onClick={() => handleStartRename(project)}
                        className="h-auto px-3 py-1.5 text-xs"
                      >
                        <Pencil aria-hidden="true" className="h-3 w-3 mr-1" />
                        Rename
                      </PrimaryButton>
                      <PrimaryButton
                        variant="outline"
                        size="sm"
                        onClick={() => setDeletingId(project.id)}
                        className="h-auto px-3 py-1.5 text-xs text-destructive hover:text-destructive ml-auto"
                      >
                        <Trash2 aria-hidden="true" className="h-3 w-3 mr-1" />
                        Delete
                      </PrimaryButton>
                    </div>
                  </>
                )}
              </div>
            ))}
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
