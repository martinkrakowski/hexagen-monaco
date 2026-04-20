"use client";

import { useRef } from "react";
import { Sun, Moon, Import, PlusCircle, Menu } from "lucide-react";

interface HeaderMenuProps {
  onLoadManifest: () => void;
  onNewProject?: () => void;
  onToggleTheme: () => void;
  theme: "light" | "dark";
}

export function HeaderMenu({
  onLoadManifest,
  onNewProject,
  onToggleTheme,
  theme,
}: HeaderMenuProps) {
  const menuRef = useRef<HTMLDetailsElement>(null);

  const closeMenu = () => {
    menuRef.current?.removeAttribute("open");
  };

  const handleNewProject = () => {
    onNewProject?.();
    closeMenu();
  };

  const handleLoadManifest = () => {
    onLoadManifest();
    closeMenu();
  };

  const handleToggleTheme = () => {
    onToggleTheme();
    closeMenu();
  };

  return (
    <details ref={menuRef} className="relative lg:hidden">
      <summary className="list-none cursor-pointer p-2 rounded-md hover:bg-muted transition-colors flex items-center justify-center">
        <Menu className="w-5 h-5" />
      </summary>
      <div className="absolute right-0 top-full mt-1 w-48 bg-card border border-border rounded-md shadow-lg py-1 z-50">
        {onNewProject && (
          <button
            onClick={handleNewProject}
            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left hover:bg-muted transition-colors text-primary font-medium"
          >
            <PlusCircle className="w-4 h-4" />
            New Project
          </button>
        )}
        <button
          onClick={handleLoadManifest}
          className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left hover:bg-muted transition-colors"
        >
          <Import className="w-4 h-4" />
          Load Manifest
        </button>
        <button
          onClick={handleToggleTheme}
          className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left hover:bg-muted transition-colors"
        >
          {theme === "dark" ? (
            <>
              <Sun className="w-4 h-4" />
              Light Mode
            </>
          ) : (
            <>
              <Moon className="w-4 h-4" />
              Dark Mode
            </>
          )}
        </button>
      </div>
    </details>
  );
}
