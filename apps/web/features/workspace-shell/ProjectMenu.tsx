"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  FolderOpen,
  Download,
  Upload,
  ChevronRight,
  FileText,
  PlusCircle,
} from "lucide-react";
import { useSavedProjects, type SavedProject } from "@/hooks/useSavedProjects";
import { SavedProjectsSubmenu } from "./SavedProjectsSubmenu";

interface ProjectMenuProps {
  onNewProject: () => void;
  onLoadManifest: () => void;
  onLoadSavedProject: (project: SavedProject) => void;

  // Export actions — owned by the Header via useProjectExport
  onExportZip: () => void;
  onRequestGithubExport: () => void;

  canExport: boolean;
  isExporting: boolean;
  isAuthenticated: boolean;
}

/**
 * Pure menu UI. Owns only local dropdown state (isOpen, submenu
 * visibility). All export state and handlers flow in as props from
 * the Header (via useProjectExport). Status/error surfaces in the
 * Header's ExportStatusStrip — NOT in this dropdown, which closes
 * on action.
 */
export function ProjectMenu({
  onNewProject,
  onLoadManifest,
  onLoadSavedProject,
  onExportZip,
  onRequestGithubExport,
  canExport,
  isExporting,
  isAuthenticated,
}: ProjectMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showSavedSubmenu, setShowSavedSubmenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const { projects, deleteProject } = useSavedProjects();

  const closeMenu = useCallback(() => {
    setIsOpen(false);
    setShowSavedSubmenu(false);
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        closeMenu();
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenu();
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [closeMenu]);

  const handleSavedProjectClick = useCallback(
    (project: SavedProject) => {
      closeMenu();
      onLoadSavedProject(project);
    },
    [closeMenu, onLoadSavedProject],
  );

  const handleMenuAction = useCallback(
    (action: () => void) => () => {
      closeMenu();
      action();
    },
    [closeMenu],
  );

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
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
            onClick={handleMenuAction(onNewProject)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted text-left"
          >
            <PlusCircle className="w-4 h-4" />
            New Project
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={handleMenuAction(onLoadManifest)}
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
              aria-haspopup="menu"
              aria-expanded={showSavedSubmenu}
              onClick={() => setShowSavedSubmenu((prev) => !prev)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-muted text-left"
            >
              <span className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Saved Projects
              </span>
              <ChevronRight className="w-3 h-3" />
            </button>

            <SavedProjectsSubmenu
              open={showSavedSubmenu}
              projects={projects}
              onSelect={handleSavedProjectClick}
              onDelete={deleteProject}
            />
          </div>

          <div className="h-px bg-border my-1" />

          <button
            type="button"
            role="menuitem"
            onClick={handleMenuAction(onExportZip)}
            disabled={!canExport || isExporting}
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left ${
              !canExport || isExporting
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
            onClick={handleMenuAction(onRequestGithubExport)}
            disabled={isExporting}
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left ${
              isExporting ? "opacity-50 cursor-not-allowed" : "hover:bg-muted"
            }`}
          >
            <Upload className="w-4 h-4" />
            {isAuthenticated ? "Push to GitHub" : "Sign in to GitHub"}
          </button>
        </div>
      )}
    </div>
  );
}
