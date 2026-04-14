"use client";

import React, { useState, useMemo } from "react";
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
import { MonacoViewer } from "@/components/monaco/MonacoViewer";
import { useProjectGeneration } from "@/hooks/use-project-generation";
import { useArchitectureDownload } from "@/hooks/use-architecture-download";
import type { WizardData } from "@hexagen/shared";
import type { ViewFileNode } from "./types";

interface CodeViewProps {
  wizardData: WizardData;
}

export const CodeView: React.FC<CodeViewProps> = ({ wizardData }) => {
  const [selectedFile, setSelectedFile] = useState<ViewFileNode | null>(null);

  const {
    files,
    loading,
    isDownloading,
    error,
    isStale,
    refresh,
    downloadZip,
  } = useProjectGeneration(wizardData);

  const { downloadArchitectureZip, isDownloading: isDownloadingArch } =
    useArchitectureDownload(wizardData);

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
              onClick={downloadArchitectureZip}
              disabled={isDownloadingArch}
              title="Download Architecture (.architecture/)"
            >
              {isDownloadingArch ? (
                <Loader2 size={14} className="animate-spin text-primary" />
              ) : (
                <Archive size={14} />
              )}
            </ExplorerToolbar.ActionButton>

            <ExplorerToolbar.ActionButton
              onClick={downloadZip}
              disabled={isNetworkActive || files.size === 0}
              title="Download Project (ZIP)"
            >
              {isDownloading ? (
                <Loader2 size={14} className="animate-spin text-primary" />
              ) : (
                <Download size={14} />
              )}
            </ExplorerToolbar.ActionButton>

            <ExplorerToolbar.StaleIndicator isStale={isStale} onClick={refresh}>
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
            selectedId={selectedFile?.id || null}
            onSelect={setSelectedFile}
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
              <MonacoViewer
                content={selectedFile.content || ""}
                language={selectedFile.language}
              />
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
