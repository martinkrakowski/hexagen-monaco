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

interface ProjectMenuProps {
  onNewProject: () => void;
  onNavigateToProjects: () => void;

  onExportZip: () => void;
  onRequestGithubExport: () => void;

  canExport: boolean;
  isExporting: boolean;
  isAuthenticated: boolean;
}

export function ProjectMenu({
  onNewProject,
  onNavigateToProjects,
  onExportZip,
  onRequestGithubExport,
  canExport,
  isExporting,
  isAuthenticated,
}: ProjectMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => {
    setIsOpen(false);
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
            onClick={handleMenuAction(onNavigateToProjects)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted text-left"
          >
            <FileText className="w-4 h-4" />
            Saved Projects
          </button>

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
            disabled
            title="Coming soon"
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left opacity-50 cursor-not-allowed"
          >
            <Upload className="w-4 h-4" />
            {isAuthenticated ? "Push to GitHub" : "Sign in to GitHub"}
          </button>
        </div>
      )}
    </div>
  );
}
