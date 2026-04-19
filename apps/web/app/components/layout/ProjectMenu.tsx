"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  FolderOpen,
  Download,
  Upload,
  ChevronRight,
  Github,
  Trash2,
  FileText,
  PlusCircle,
} from "lucide-react";
import { useExternalIntegration } from "@/contexts/ExternalIntegrationContext";
import { useActiveWorkspace } from "@/contexts/ActiveWorkspaceContext";
import { useSavedProjects, type SavedProject } from "@/hooks/use-saved-projects";
import {
  ExportDialog,
  type ExportDialogSubmitPayload,
} from "@/components/export/ExportDialog";

interface ProjectMenuProps {
  onNewProject?: () => void;
  onLoadManifest?: () => void;
  onLoadSavedProject?: (project: SavedProject) => void;
}

export function ProjectMenu({
  onNewProject,
  onLoadManifest,
  onLoadSavedProject,
}: ProjectMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showSavedSubmenu, setShowSavedSubmenu] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const { isAuthenticated, signIn } = useExternalIntegration();
  const { activeWorkspace } = useActiveWorkspace();
  const { projects, deleteProject } = useSavedProjects();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setShowSavedSubmenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const canExport = !!activeWorkspace;

  const handleDownloadZip = useCallback(async () => {
    if (!activeWorkspace) return;
    setExporting(true);
    setExportError(null);
    setStatusMessage(null);
    try {
      const response = await fetch("/api/export/zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: activeWorkspace.projectId,
          wizardData: activeWorkspace.wizardData,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? `ZIP export failed (${response.status})`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${activeWorkspace.name || activeWorkspace.projectId}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setStatusMessage("ZIP downloaded");
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "ZIP export failed");
    } finally {
      setExporting(false);
    }
  }, [activeWorkspace]);

  const handlePushToGitHub = useCallback(async () => {
    if (!isAuthenticated) {
      await signIn();
      return;
    }
    if (!activeWorkspace) return;
    setExportError(null);
    setStatusMessage(null);
    setExportDialogOpen(true);
  }, [isAuthenticated, signIn, activeWorkspace]);

  const handleExportSubmit = useCallback(
    async ({ repoName, isPrivate }: ExportDialogSubmitPayload) => {
      if (!activeWorkspace) return;
      setExporting(true);
      setExportError(null);
      try {
        const response = await fetch("/api/export/github", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: activeWorkspace.projectId,
            repoName,
            isPrivate,
            wizardData: activeWorkspace.wizardData,
          }),
        });
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
          destinationUrl?: string;
        };
        if (!response.ok || data.error) {
          throw new Error(data.error ?? `Push failed (${response.status})`);
        }
        if (data.destinationUrl) {
          setStatusMessage(`Pushed to ${data.destinationUrl}`);
          window.open(data.destinationUrl, "_blank", "noopener,noreferrer");
        }
        setExportDialogOpen(false);
      } catch (e) {
        setExportError(e instanceof Error ? e.message : "GitHub push failed");
      } finally {
        setExporting(false);
      }
    },
    [activeWorkspace],
  );

  const handleSavedProjectClick = useCallback(
    (project: SavedProject) => {
      setIsOpen(false);
      setShowSavedSubmenu(false);
      onLoadSavedProject?.(project);
    },
    [onLoadSavedProject],
  );

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        <FolderOpen className="w-3.5 h-3.5" />
        Project
        <ChevronRight
          className={`w-3 h-3 transition-transform ${isOpen ? "rotate-90" : ""}`}
        />
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 w-56 bg-card border border-border rounded-md shadow-lg py-1 z-50"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              onNewProject?.();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted text-left"
          >
            <PlusCircle className="w-4 h-4" />
            New Project
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              onLoadManifest?.();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted text-left"
          >
            <Upload className="w-4 h-4" />
            Import Manifest
          </button>

          <div className="h-px bg-border my-1" />

          <div
            className="relative"
            onMouseEnter={() => setShowSavedSubmenu(true)}
            onMouseLeave={() => setShowSavedSubmenu(false)}
          >
            <button
              type="button"
              role="menuitem"
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-muted text-left"
            >
              <span className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Saved Projects
              </span>
              <ChevronRight className="w-3 h-3" />
            </button>

            {showSavedSubmenu && (
              <div
                role="menu"
                className="absolute left-full top-0 ml-[-1px] w-56 bg-card border border-border rounded-md shadow-lg py-1 z-50"
              >
                {projects.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-muted-foreground">
                    No saved projects
                  </p>
                ) : (
                  projects.slice(0, 5).map((project) => (
                    <div
                      key={project.id}
                      className="flex items-center justify-between px-3 py-2 text-sm hover:bg-muted"
                    >
                      <button
                        type="button"
                        onClick={() => handleSavedProjectClick(project)}
                        className="flex-1 truncate text-left"
                      >
                        {project.name}
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${project.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteProject(project.id);
                        }}
                        className="p-1 hover:bg-destructive/20 rounded"
                      >
                        <Trash2 className="w-3 h-3 text-destructive" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="h-px bg-border my-1" />

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              void handleDownloadZip();
            }}
            disabled={!canExport || exporting}
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left ${
              !canExport || exporting
                ? "opacity-50 cursor-not-allowed"
                : "hover:bg-muted"
            }`}
          >
            <Download className="w-4 h-4" />
            Download as ZIP
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              void handlePushToGitHub();
            }}
            disabled={exporting}
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left ${
              exporting ? "opacity-50 cursor-not-allowed" : "hover:bg-muted"
            }`}
          >
            <Github className="w-4 h-4" />
            {isAuthenticated ? "Push to GitHub" : "Sign in to GitHub"}
          </button>

          {statusMessage ? (
            <p className="px-3 py-1 text-xs text-muted-foreground">
              {statusMessage}
            </p>
          ) : null}
          {exportError ? (
            <p
              className="px-3 py-1 text-xs text-destructive"
              role="alert"
            >
              {exportError}
            </p>
          ) : null}
        </div>
      )}

      <ExportDialog
        open={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
        onSubmit={handleExportSubmit}
        isSubmitting={exporting}
        initialRepoName={activeWorkspace?.name ?? ""}
        error={exportError}
      />
    </div>
  );
}
