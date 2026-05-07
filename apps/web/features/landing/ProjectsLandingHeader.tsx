"use client";

import { useTheme } from "@/hooks/useTheme";
import { Sun, Moon, Plus } from "lucide-react";
import { Button } from "@hexagen/ui";

interface ProjectsLandingHeaderProps {
  onNewProject: () => void;
}

export function ProjectsLandingHeader({
  onNewProject,
}: ProjectsLandingHeaderProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="w-full px-6 py-1 bg-card border-b border-border flex items-center justify-between">
      <div className="flex items-center gap-3">
        <img
          src="https://hexagen-monaco.cloud/images/hexagen-monaco-logotype-2.svg"
          alt="HexaGen Monaco"
          className="h-12 w-auto"
        />
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={onNewProject} size="sm">
          <Plus className="h-4 w-4 mr-1" />
          New Project
        </Button>
        <button
          type="button"
          onClick={toggleTheme}
          className="p-2 rounded-md hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? (
            <Sun className="w-4 h-4" />
          ) : (
            <Moon className="w-4 h-4" />
          )}
        </button>
      </div>
    </header>
  );
}
