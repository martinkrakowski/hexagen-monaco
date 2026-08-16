"use client";

import React, { useMemo } from "react";
import {
  FileCode,
  Loader2,
  AlertCircle,
  Download,
  Archive,
  RefreshCw,
} from "lucide-react";
import { mapToFolderTree } from "@/lib/tree-utils";
import { FileTree } from "./FileTree";
import { ExplorerToolbar } from "./ExplorerToolbar";
import { GenerationNoticesBar } from "./GenerationNoticesBar";
import {
  type ViewFileNode,
  type GenerationNotices,
  ADDON_NOTICES_FILENAME,
} from "../types";

/**
 * Everything the explorer knows about generation arrives as data. There is no
 * `wizardData` here on purpose: the presentational half must not be able to
 * *start* a generation, only to display one and to raise intents.
 */
export interface CodeExplorerProps {
  /** Generated file id → contents. The explorer never fetches these. */
  files: Map<string, string>;
  notices: GenerationNotices;
  /** A generation run is in flight. */
  loading: boolean;
  /** A project-ZIP download is in flight. */
  isDownloading: boolean;
  /** An architecture-ZIP download is in flight. */
  isDownloadingArchitecture: boolean;
  /** Single error slot — the boundary decides which source wins. */
  error: string | null;
  isStale: boolean;
  onRefresh: () => void;
  onDownloadZip: () => void;
  onDownloadArchitecture: () => void;
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
 * Presentational file explorer + editor frame (REA-003).
 *
 * This component performs no I/O: no `fetch`, no ZIP building, no persistence,
 * no generation hooks. Everything it shows is a prop and everything it wants is
 * a callback, so it renders — and is testable — from a plain object literal.
 * The generation/download transports live one level up in `CodeView`.
 *
 * The directory it lives in is the boundary: `apps/web/eslint.config.js`
 * restricts `features/code-view/explorer/**` from importing the generation
 * hooks or the client DI container, so the coupling cannot creep back by
 * someone adding "just one hook".
 */
export const CodeExplorer: React.FC<CodeExplorerProps> = ({
  files,
  notices,
  loading,
  isDownloading,
  isDownloadingArchitecture,
  error,
  isStale,
  onRefresh,
  onDownloadZip,
  onDownloadArchitecture,
  selectedFileId,
  editedFiles,
  onFileSelect,
  onFileContentChange,
  onFileSave,
  editorSlot,
}) => {
  const selectedFile = useMemo((): ViewFileNode | null => {
    if (!selectedFileId) return null;
    const content = files.get(selectedFileId);
    if (!content) return null;
    return {
      id: selectedFileId,
      name: selectedFileId.split("/").pop() || selectedFileId,
      type: "file",
      language: selectedFileId.split(".").pop() || "text",
      content,
    };
  }, [selectedFileId, files]);

  const displayContent = selectedFileId
    ? (editedFiles.get(selectedFileId) ?? files.get(selectedFileId) ?? "")
    : "";

  const fileTree = useMemo(() => mapToFolderTree(files), [files]);
  const isNetworkActive = loading || isDownloading;

  return (
    <div className="flex h-full w-full bg-background overflow-hidden text-foreground">
      {/* Sidebar */}
      <div className="w-64 border-r border-border bg-muted flex flex-col hidden md:flex shrink-0">
        <ExplorerToolbar.Root isNetworkActive={isNetworkActive}>
          <ExplorerToolbar.Label>Explorer</ExplorerToolbar.Label>
          <ExplorerToolbar.Actions>
            <ExplorerToolbar.ActionButton
              onClick={onDownloadArchitecture}
              disabled={isDownloadingArchitecture}
              title="Download Architecture (.architecture/)"
            >
              {isDownloadingArchitecture ? (
                <Loader2 size={14} className="animate-spin text-primary" />
              ) : (
                <Archive size={14} />
              )}
            </ExplorerToolbar.ActionButton>

            <ExplorerToolbar.ActionButton
              onClick={onDownloadZip}
              disabled={isNetworkActive || files.size === 0}
              title="Download Project (ZIP)"
            >
              {isDownloading ? (
                <Loader2 size={14} className="animate-spin text-primary" />
              ) : (
                <Download size={14} />
              )}
            </ExplorerToolbar.ActionButton>

            <ExplorerToolbar.StaleIndicator
              isStale={isStale}
              onClick={onRefresh}
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </ExplorerToolbar.StaleIndicator>
          </ExplorerToolbar.Actions>
        </ExplorerToolbar.Root>

        {error ? (
          <div className="p-4 text-destructive text-sm flex items-start gap-2">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        ) : loading && files.size === 0 ? (
          <div className="p-8 flex justify-center text-muted-foreground">
            <Loader2 className="animate-spin h-6 w-6" />
          </div>
        ) : (
          <FileTree
            data={fileTree}
            selectedId={selectedFileId}
            onSelect={(node) =>
              onFileSelect(node?.type === "file" ? node.id : null)
            }
          />
        )}
      </div>

      {/* Main Editor Area */}
      <div className="flex-1 flex flex-col overflow-hidden bg-background relative">
        {isNetworkActive && files.size > 0 && (
          <div className="absolute top-0 left-0 right-0 h-1 bg-primary/20 overflow-hidden z-10">
            <div className="h-full bg-primary w-1/3 animate-slide" />
          </div>
        )}

        <GenerationNoticesBar
          notices={notices}
          onOpenNoticesFile={
            files.has(ADDON_NOTICES_FILENAME)
              ? () => onFileSelect(ADDON_NOTICES_FILENAME)
              : undefined
          }
        />

        {selectedFile ? (
          <div className="flex flex-col h-full">
            <div className="px-4 py-2.5 border-b border-border bg-muted/30 flex items-center justify-between text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <FileCode className="h-4 w-4" />
                <span className="text-foreground font-medium">
                  {selectedFile.id}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {isStale && (
                  <span className="text-xs text-warning italic">
                    Out of sync
                  </span>
                )}
                <div className="text-xs uppercase bg-muted px-2 py-1 rounded border border-border">
                  {selectedFile.language}
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-hidden">
              {editorSlot({
                initialContent: displayContent,
                language: selectedFile.language ?? "text",
                sessionId: `code-view-${selectedFile.id}`,
                onSave: (content) => {
                  if (selectedFileId) {
                    onFileContentChange(selectedFileId, content);
                    onFileSave?.(selectedFileId);
                  }
                },
              })}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-muted-foreground">
            <div className="p-4 rounded-md mb-4 bg-muted border border-border">
              <FileCode className="h-10 w-10 opacity-30" />
            </div>
            <h3 className="text-lg font-medium text-foreground">
              {files.size > 0 ? "Select a file" : "Ready to generate"}
            </h3>
            <p className="text-sm max-w-xs mt-2">
              {files.size > 0
                ? "Choose a file from the explorer to view its generated source code."
                : "Awaiting architectural data to generate source files."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
