"use client";

import { useTheme } from "@/hooks/useTheme";
import { Sun, Moon } from "lucide-react";
import { HeaderMenu } from "./HeaderMenu";
import { ProjectMenu } from "./ProjectMenu";
import { ExportStatusStrip } from "./ExportStatusStrip";
import { ExportDialog } from "../export/ExportDialog";
import { useProjectExport } from "@/contexts/ExportContext";
import { useActiveWorkspace } from "@/contexts/ActiveWorkspaceContext";

interface HeaderProps {
  onLoadManifest: () => void;
  onNewProject: () => void;
  onOpenWelcomeManifest: () => void;
  onNavigateToProjects?: () => void;
  isEditing?: boolean;
}

export function Header({
  onLoadManifest,
  onNewProject,
  onOpenWelcomeManifest,
  onNavigateToProjects,
  isEditing = false,
}: HeaderProps) {
  const { theme, toggleTheme } = useTheme();
  const { activeWorkspace } = useActiveWorkspace();
  const exportFlow = useProjectExport();

  const isExporting = exportFlow.state.kind === "exporting";
  const dialogError =
    exportFlow.state.kind === "error" ? exportFlow.state.message : null;

  return (
    <div className="shrink-0">
      <header className="w-full px-6 py-1 bg-card border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          {onNavigateToProjects ? (
            <button
              type="button"
              onClick={onNavigateToProjects}
              className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
              aria-label="Go to projects"
            >
              <img
                src="https://hexagen-monaco.cloud/images/hexagen-monaco-logotype-2.svg"
                alt="HexaGen Monaco"
                className="h-12 w-auto"
              />
            </button>
          ) : (
            <img
              src="https://hexagen-monaco.cloud/images/hexagen-monaco-logotype-2.svg"
              alt="HexaGen Monaco"
              className="h-12 w-auto"
            />
          )}
        </div>
        <div className="flex items-center gap-2">
          {isEditing && (
            <span className="text-xs font-medium text-muted-foreground px-2 py-1">
              Editing
            </span>
          )}
          <HeaderMenu
            onLoadManifest={onLoadManifest}
            onNewProject={onNewProject}
            onOpenWelcomeManifest={onOpenWelcomeManifest}
            onToggleTheme={toggleTheme}
            theme={theme}
          />
          <div className="hidden lg:flex items-center gap-2">
            <ProjectMenu
              onNewProject={onNewProject}
              onNavigateToProjects={onNavigateToProjects}
              onExportZip={() => void exportFlow.exportZip()}
              onRequestGithubExport={() =>
                void exportFlow.requestGithubExport()
              }
              canExport={exportFlow.canExport}
              isExporting={isExporting}
              isAuthenticated={exportFlow.isAuthenticated}
            />
            <button
              type="button"
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
        </div>
      </header>

      <ExportStatusStrip
        state={exportFlow.state}
        onDismiss={exportFlow.dismissStatus}
      />

      <ExportDialog
        key={activeWorkspace?.name ?? ""}
        open={exportFlow.state.kind === "dialog-open"}
        onClose={exportFlow.closeDialog}
        onSubmit={exportFlow.submitGithubExport}
        isSubmitting={isExporting}
        initialRepoName={activeWorkspace?.name ?? ""}
        error={dialogError}
      />
    </div>
  );
}
