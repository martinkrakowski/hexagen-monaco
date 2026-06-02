"use client";

import { Download, Upload, Settings } from "lucide-react";

import { SummarySection } from "./SummarySection";

interface ExportActionsProps {
  isAuthenticated: boolean;
  isExporting: boolean;
  onExportZip: () => void;
  onRequestGithubExport: () => void;
  /** Connected repo (owner/repo) — relabels the button and reveals the gear. */
  connectedRepo?: { owner: string; repo: string } | null;
  /** Open the publish-settings modal (gear) — only meaningful when connected. */
  onOpenPublishSettings?: () => void;
}

/**
 * ZIP download + GitHub publish buttons. Purely presentational — all
 * state lives in ExportContext (the Header renders progress/errors
 * via ExportStatusStrip, which outlives this step).
 *
 * When the project is already linked, the publish button relabels to
 * "Update owner/repo" (it reuses the repo rather than creating one) and a
 * gear opens the publish-settings modal to change what the button does.
 *
 * The parent SummaryStep only mounts this when a project has been
 * generated (canExport === true), so the buttons always have a
 * workspace to export from.
 */
export function ExportActions({
  isAuthenticated,
  isExporting,
  onExportZip,
  onRequestGithubExport,
  connectedRepo,
  onOpenPublishSettings,
}: ExportActionsProps) {
  const githubLabel = !isAuthenticated
    ? "Sign in to GitHub"
    : connectedRepo
      ? `Update ${connectedRepo.owner}/${connectedRepo.repo}`
      : "Push to GitHub";

  return (
    <SummarySection title="Export">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onExportZip}
          disabled={isExporting}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium border border-input hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download className="w-4 h-4" />
          Download as ZIP
        </button>
        <button
          type="button"
          onClick={onRequestGithubExport}
          disabled={isExporting}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Upload className="w-4 h-4" />
          {githubLabel}
        </button>
        {connectedRepo && onOpenPublishSettings ? (
          <button
            type="button"
            onClick={onOpenPublishSettings}
            disabled={isExporting}
            aria-label="GitHub publish settings"
            title="GitHub publish settings"
            className="inline-flex items-center justify-center p-1.5 rounded-md border border-input hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Settings className="w-4 h-4" />
          </button>
        ) : null}
      </div>
      {/*
       * Export status + errors surface in the Header's
       * ExportStatusStrip (persistent, outlives this step).
       */}
    </SummarySection>
  );
}
