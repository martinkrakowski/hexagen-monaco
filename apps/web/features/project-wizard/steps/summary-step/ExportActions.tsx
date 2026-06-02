"use client";

import { Download, Upload } from "lucide-react";

import { SummarySection } from "./SummarySection";

interface ExportActionsProps {
  isAuthenticated: boolean;
  isExporting: boolean;
  onExportZip: () => void;
  onRequestGithubExport: () => void;
  /** Optional connected repo info for Phase 1 indicator (owner/repo). */
  connectedRepo?: { owner: string; repo: string } | null;
}

/**
 * ZIP download + GitHub push buttons. Purely presentational — all
 * state lives in ExportContext (the Header renders progress/errors
 * via ExportStatusStrip, which outlives this step).
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
}: ExportActionsProps) {
  return (
    <SummarySection title="Export">
      <div className="flex flex-wrap gap-2">
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
          {isAuthenticated ? "Push to GitHub" : "Sign in to GitHub"}
        </button>
      </div>
      {connectedRepo && (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <span aria-hidden>↗</span>
          <span>
            Connected to {connectedRepo.owner}/{connectedRepo.repo}
          </span>
        </div>
      )}
      {/*
       * Export status + errors surface in the Header's
       * ExportStatusStrip (persistent, outlives this step).
       */}
    </SummarySection>
  );
}
