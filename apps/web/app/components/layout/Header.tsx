"use client";

import { useTheme } from "@/hooks/use-theme";
import { Sun, Moon, Upload } from "lucide-react";

interface HeaderProps {
  onLoadManifest: () => void;
  mode: "genesis" | "edit";
}

export const Header = ({ onLoadManifest, mode }: HeaderProps) => {
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
        {mode === "edit" && (
          <span className="text-xs font-medium bg-warning/10 text-warning px-2 py-1 rounded border border-warning/20">
            Editing loaded project
          </span>
        )}
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
