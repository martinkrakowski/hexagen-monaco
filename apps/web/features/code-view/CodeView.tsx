"use client";

import React from "react";
import { useProjectGeneration } from "./hooks/useProjectGeneration";
import { useArchitectureDownload } from "./hooks/useArchitectureDownload";
import { CodeExplorer } from "./explorer/CodeExplorer";
import type { WizardData } from "@hexagen/project-configuration";

interface CodeViewProps {
  wizardData: WizardData;
  /**
   * The saved record's manifestYaml — source of truth for IMPORTED projects
   * (import round-trip integrity, Item 1.3). Both generation hooks consult it
   * only when `wizardData.manifestSource === "imported"`.
   */
  savedManifestYaml?: string | null;
  selectedFileId: string | null;
  editedFiles: Map<string, string>;
  onFileSelect: (fileId: string | null) => void;
  onFileContentChange: (fileId: string, content: string) => void;
  onFileSave?: (fileId: string) => void;
  editorSlot: (props: {
    initialContent: string;
    language: string;
    sessionId: string;
    onSave: (content: string) => void;
  }) => React.ReactNode;
}

/**
 * Generation boundary for the code view (REA-003).
 *
 * This component owns every transport the explorer needs — `POST /api/generate`
 * (`useProjectGeneration`) and the client-side architecture ZIP
 * (`useArchitectureDownload`) — and hands the results down as plain data. It
 * renders no chrome of its own.
 *
 * The split exists because the two concerns had different reasons to change and
 * only one of them was testable: before it, rendering a file tree required a
 * `wizardData` and fired a generation request on mount, so the explorer could
 * not be exercised without the network. Keep new I/O here; keep presentation in
 * `explorer/`, whose directory is lint-fenced against reaching back for it.
 */
export const CodeView: React.FC<CodeViewProps> = ({
  wizardData,
  savedManifestYaml,
  ...explorerProps
}) => {
  const {
    files,
    notices,
    loading,
    isDownloading,
    error,
    isStale,
    refresh,
    downloadZip,
  } = useProjectGeneration(wizardData, savedManifestYaml);

  const {
    downloadArchitectureZip,
    isDownloading: isDownloadingArch,
    error: archError,
  } = useArchitectureDownload(wizardData, savedManifestYaml);

  // One sidebar error slot: the generation error wins (it blocks the whole
  // view); the architecture-download fail-closed error shows when that's all
  // there is.
  const displayError = error ?? archError;

  return (
    <CodeExplorer
      {...explorerProps}
      files={files}
      notices={notices}
      loading={loading}
      isDownloading={isDownloading}
      isDownloadingArchitecture={isDownloadingArch}
      error={displayError}
      isStale={isStale}
      onRefresh={refresh}
      onDownloadZip={downloadZip}
      onDownloadArchitecture={downloadArchitectureZip}
    />
  );
};
