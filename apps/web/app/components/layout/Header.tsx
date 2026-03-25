"use client";

import { useTheme } from "../../hooks/use-theme";
import { Sun, Moon, Upload } from "lucide-react";

interface HeaderProps {
  onLoadManifest: () => void;
  mode: "genesis" | "edit";
}

export const Header = ({ onLoadManifest, mode }: HeaderProps) => {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="w-full p-5 pl-6 pb-1 bg-background flex items-center justify-between">
      <h1 className="text-2xl font-bold p-1">
        Hexagen Monaco Project Generator
      </h1>
      <div className="flex items-center gap-3">
        {mode === "edit" && (
          <span className="text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2 py-1 rounded">
            Editing loaded project
          </span>
        )}
        <button
          onClick={onLoadManifest}
          className="p-2 rounded-lg hover:bg-accent transition-colors"
          aria-label="Load manifest"
          title="Load manifest.yaml"
        >
          <Upload className="w-5 h-5 text-foreground" />
        </button>
        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg hover:bg-accent transition-colors"
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? (
            <Moon className="w-5 h-5 text-sidebar-foreground" />
          ) : (
            <Sun className="w-5 h-5 text-foreground" />
          )}
        </button>
      </div>
    </header>
  );
};
