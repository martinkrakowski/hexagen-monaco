"use client";

import React, { useState, useMemo } from "react";
import {
  FileCode,
  Loader2,
  RefreshCw,
  AlertCircle,
  Download,
} from "lucide-react";
import { mapToFolderTree } from "@/lib/tree-utils";
import { FileTree } from "./FileTree";
import { MonacoViewer } from "@/components/monaco/MonacoViewer";
import { useProjectGeneration } from "@/hooks/use-project-generation";
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

  const fileTree = useMemo(() => mapToFolderTree(files), [files]);
  const isNetworkActive = loading || isDownloading;

  return (
    <div className="flex h-full w-full bg-slate-950 overflow-hidden text-slate-300">
      {/* Sidebar */}
      <div className="w-64 border-r border-slate-800 bg-slate-900 flex flex-col hidden md:flex shrink-0">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider p-4 border-b border-slate-800 shrink-0 flex items-center justify-between">
          <span>Explorer</span>
          <div className="flex items-center gap-3">
            {/* Download Button */}
            <button
              onClick={downloadZip}
              disabled={isNetworkActive || files.size === 0}
              className="transition-colors disabled:opacity-50 hover:text-slate-300"
              title="Download Project (ZIP)"
            >
              {isDownloading ? (
                <Loader2 size={14} className="animate-spin text-blue-400" />
              ) : (
                <Download size={14} />
              )}
            </button>

            {/* Refresh Button */}
            <div className="relative flex items-center">
              <button
                onClick={refresh}
                disabled={isNetworkActive}
                className={`transition-colors disabled:opacity-50 ${isStale ? "text-blue-400 hover:text-blue-300" : "hover:text-slate-300"}`}
                title={
                  isStale
                    ? "Pending changes. Click to regenerate."
                    : "Force Regenerate"
                }
              >
                <RefreshCw
                  size={14}
                  className={loading ? "animate-spin" : ""}
                />
              </button>
              {isStale && !isNetworkActive && (
                <span className="absolute -top-1 -right-1 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                </span>
              )}
            </div>
          </div>
        </div>

        {error ? (
          <div className="p-4 text-red-400 text-sm flex items-start gap-2">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        ) : loading && files.size === 0 ? (
          <div className="p-8 flex justify-center text-slate-600">
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
      <div className="flex-1 flex flex-col overflow-hidden bg-slate-950 relative">
        {isNetworkActive && files.size > 0 && (
          <div className="absolute top-0 left-0 right-0 h-1 bg-blue-500/20 overflow-hidden z-10">
            <div className="h-full bg-blue-500 w-1/3 animate-slide" />
          </div>
        )}

        {selectedFile ? (
          <div className="flex flex-col h-full">
            <div className="px-4 py-2 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between text-sm text-slate-400">
              <div className="flex items-center">
                <FileCode className="h-4 w-4 mr-2 text-slate-500" />
                {selectedFile.id}
              </div>
              <div className="flex items-center gap-3">
                {isStale && (
                  <span className="text-xs text-blue-400 italic">
                    Out of sync
                  </span>
                )}
                <div className="text-xs uppercase bg-slate-800 px-2 py-1 rounded">
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
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-slate-500">
            <div className="p-4 rounded-full mb-4 bg-slate-900">
              <FileCode className="h-10 w-10 opacity-30" />
            </div>
            <h3 className="text-lg font-medium text-slate-300">
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
