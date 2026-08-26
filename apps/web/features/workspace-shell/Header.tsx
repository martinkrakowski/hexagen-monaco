"use client";

import { useTheme } from "@/hooks/useTheme";
import { Sun, Moon } from "lucide-react";
import { HeaderMenu } from "./HeaderMenu";
import { TenantMenu } from "./TenantMenu";
import { ProjectMenu } from "./ProjectMenu";
import { ExportStatusStrip } from "./ExportStatusStrip";
import { ExportDialog } from "../export/ExportDialog";
import { PublishSettingsDialog } from "../export/PublishSettingsDialog";
import { useZipExport } from "@/contexts/ZipExportContext";
import { useGithubPublish } from "@/contexts/GithubPublishContext";
import { useProjectExportRecord } from "@/contexts/ProjectExportRecordContext";
import { isPublishDialogOpen } from "@/contexts/export-state";
import type { ExportDialogPhase } from "../export/ExportDialog";
import { useActiveWorkspace } from "@/contexts/ActiveWorkspaceContext";

interface HeaderProps {
  onLoadManifest: () => void;
  onNewProject: () => void;
  onOpenWelcomeManifest: () => void;
  onNavigateToProjects?: () => void;
  isEditing?: boolean;
  /**
   * Workspace-phase switcher slot (Plan ↔ Architecture). A slot rather than a
   * context consumer because this Header is also mounted outside the wizard
   * lifecycle provider (apps/web/app/projects/layout.tsx).
   */
  phaseSlot?: React.ReactNode;
}

export function Header({
  onLoadManifest,
  onNewProject,
  onOpenWelcomeManifest,
  onNavigateToProjects,
  isEditing = false,
  phaseSlot,
}: HeaderProps) {
  const { theme, toggleTheme } = useTheme();
  const { activeWorkspace } = useActiveWorkspace();
  const zip = useZipExport();
  const publish = useGithubPublish();
  const { connectedRepo } = useProjectExportRecord();

  // The menu's single "busy" affordance still spans both flows — the Header is
  // the one component that legitimately composes them.
  const isExporting = zip.state.kind === "exporting" || publish.isPublishing;

  // Derive the GitHub dialog's panel + data from the publish state machine.
  const s = publish.state;
  const dialogPhase: ExportDialogPhase =
    s.kind === "publishing"
      ? "submitting"
      : s.kind === "success"
        ? "success"
        : s.kind === "error"
          ? "error"
          : "form";
  const dialogError = s.kind === "error" ? s.message : null;
  // The actionable code (workflow_scope_required / reauth_required) gates the
  // dialog's Reconnect/sign-in affordance; generic failures carry none.
  const dialogErrorCode = s.kind === "error" ? (s.code ?? null) : null;
  // Provide a success payload whenever the github flow succeeds — even if the
  // structured githubLink is absent — so phase="success" never renders a blank
  // body. owner/repo/url are optional; the dialog falls back to `message`.
  const dialogSuccess =
    s.kind === "success"
      ? {
          message: s.message,
          owner: s.githubLink?.owner,
          repo: s.githubLink?.repo,
          url: s.githubLink?.htmlUrl ?? s.destinationUrl,
          notices: s.notices,
          // Raw degraded-publish warning strings (e.g. workflow-scope skips);
          // the dialog prefers them over the count-based add-on copy.
          warningMessages: s.warnings,
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
          {phaseSlot}
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
            {/* Desktop-only tenant switcher; renders nothing when signed out
                or when no TenantProvider is mounted (wizard chrome). */}
            <TenantMenu />
            <ProjectMenu
              onNewProject={onNewProject}
              onNavigateToProjects={onNavigateToProjects}
              onExportZip={() => void zip.exportZip()}
              onRequestGithubExport={() => void publish.requestGithubExport()}
              onOpenPublishSettings={() => void publish.openPublishSettings()}
              canExport={zip.canExport}
              isExporting={isExporting}
              isAuthenticated={publish.isAuthenticated}
              connectedRepo={connectedRepo}
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

      <ExportStatusStrip state={zip.state} onDismiss={zip.dismissStatus} />

      <ExportDialog
        key={activeWorkspace?.name ?? ""}
        open={isPublishDialogOpen(s)}
        phase={dialogPhase}
        onClose={publish.closeDialog}
        onSubmit={publish.submitGithubExport}
        onRetry={() => void publish.retryGithubExport()}
        onBackToForm={publish.showGithubDialog}
        onReconnect={() => publish.reconnectGithub()}
        initialRepoName={activeWorkspace?.name ?? ""}
        error={dialogError}
        errorCode={dialogErrorCode}
        success={dialogSuccess}
      />

      <PublishSettingsDialog
        open={s.kind === "settings-open"}
        repo={s.kind === "settings-open" ? s.repo : { owner: "", repo: "" }}
        defaultMode={s.kind === "settings-open" ? s.defaultMode : "scaffold"}
        defaultMessage={s.kind === "settings-open" ? s.defaultMessage : ""}
        defaultRemember={s.kind === "settings-open" ? s.defaultRemember : false}
        hasEditorEdits={s.kind === "settings-open" ? s.hasEditorEdits : false}
        onClose={publish.closeDialog}
        onSubmit={(p) => void publish.submitPublishSettings(p)}
      />
    </div>
  );
}
