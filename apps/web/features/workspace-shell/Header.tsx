"use client";

import { useTheme } from "@/hooks/useTheme";
import { Sun, Moon } from "lucide-react";
import { HeaderMenu } from "./HeaderMenu";
import { ProjectMenu } from "./ProjectMenu";
import { ExportStatusStrip } from "./ExportStatusStrip";
import { ExportDialog } from "../export/ExportDialog";
import {
  useProjectExport,
  isGithubExportActive,
} from "@/contexts/ExportContext";
import type { ExportDialogPhase } from "../export/ExportDialog";
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

  // Derive the GitHub dialog's panel + data from the export state machine.
  const s = exportFlow.state;
  const dialogPhase: ExportDialogPhase =
    s.kind === "exporting" && s.destination === "github"
      ? "submitting"
      : s.kind === "success" && s.destination === "github"
        ? "success"
        : s.kind === "error" && s.destination === "github"
          ? "error"
          : "form";
  const dialogError =
    s.kind === "error" && s.destination === "github" ? s.message : null;
  const dialogSuccess =
    s.kind === "success" && s.destination === "github" && s.githubLink
      ? {
          owner: s.githubLink.owner,
          repo: s.githubLink.repo,
          htmlUrl: s.githubLink.htmlUrl,
        }
      : null;

  return (
    <div className="shrink-0">
      <header className="w-full px-3 sm:px-6 py-1 bg-card border-b border-border flex items-center justify-between">
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
        open={isGithubExportActive(exportFlow.state)}
        phase={dialogPhase}
        onClose={exportFlow.closeDialog}
        onSubmit={exportFlow.submitGithubExport}
        onRetry={() => void exportFlow.retryGithubExport()}
        onBackToForm={exportFlow.showGithubDialog}
        initialRepoName={activeWorkspace?.name ?? ""}
        error={dialogError}
        success={dialogSuccess}
      />
    </div>
  );
}
