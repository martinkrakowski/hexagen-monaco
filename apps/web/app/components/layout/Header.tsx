"use client";

import { useTheme } from "@/hooks/use-theme";
import { Sun, Moon, Upload, PlusCircle } from "lucide-react";

interface HeaderProps {
  onLoadManifest: () => void;
  onNewProject?: () => void;
  isEditing?: boolean;
}

export const Header = ({
  onLoadManifest,
  onNewProject,
  isEditing = false,
}: HeaderProps) => {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="w-full px-6 py-4 bg-card border-b border-border flex items-center justify-between shrink-0">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 bg-primary text-primary-foreground flex items-center justify-center rounded-sm text-sm font-bold">
          H
        </div>
        <h1 className="text-lg font-semibold tracking-tight">HexaGen</h1>
      </div>
      <div className="flex items-center gap-2">
        {isEditing && (
          <span className="text-xs font-medium text-muted-foreground px-2 py-1 border border-border rounded-md">
            Editing
          </span>
        )}
        <button
          onClick={onNewProject}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          title="Save current project and start a new one"
        >
          <PlusCircle className="w-3.5 h-3.5" />
          New Project
        </button>
        <button
          onClick={onLoadManifest}
          className="p-2 rounded-md hover:bg-muted transition-colors"
          aria-label="Load manifest"
          title="Load manifest.yaml"
        >
          <Upload className="w-4 h-4" />
        </button>
        <button
          onClick={toggleTheme}
          className="p-2 rounded-md hover:bg-muted transition-colors"
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? (
            <Moon className="w-4 h-4" />
          ) : (
            <Sun className="w-4 h-4" />
          )}
        </button>
      </div>
    </header>
  );
};
