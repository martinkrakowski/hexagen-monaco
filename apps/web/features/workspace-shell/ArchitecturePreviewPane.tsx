import React, { useMemo } from "react";
import { Card, CardContent } from "@hexagen/ui";
import { ViewToggle } from "@hexagen/ui";
import { GraphCanvasWrapper } from "../hexagon-canvas/GraphCanvasWrapper";
import { CodeView } from "../code-view/CodeView";
import { EditableMonaco } from "../monaco-editor/EditableMonaco";

import type { WizardData } from "@hexagen/project-configuration";
import type { ViewMode } from "@/types/view-mode";

interface ArchitecturePreviewPaneProps {
  wizardData: WizardData;
  viewMode: ViewMode;
  selectedFileId: string | null;
  editedFiles: Record<string, string>;
  onViewModeChange: (mode: ViewMode) => void;
  onFileSelect: (fileId: string | null) => void;
  onFileContentChange: (fileId: string, content: string) => void;
  onFileSave: (fileId: string) => void;
}

function recordToMap(record: Record<string, string>): Map<string, string> {
  const m = new Map<string, string>();
  for (const [k, v] of Object.entries(record)) {
    m.set(k, v);
  }
  return m;
}

export const ArchitecturePreviewPane = React.memo(
  function ArchitecturePreviewPane({
    wizardData,
    viewMode,
    selectedFileId,
    editedFiles,
    onViewModeChange,
    onFileSelect,
    onFileContentChange,
    onFileSave,
  }: ArchitecturePreviewPaneProps) {
    const editedFilesMap = useMemo(
      () => recordToMap(editedFiles),
      [editedFiles],
    );

    return (
      <Card className="h-full border-0 rounded-none overflow-hidden flex flex-col bg-card">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/30 shrink-0 h-12">
          <span className="font-semibold text-sm truncate">
            Architecture Preview
          </span>
          <ViewToggle
            view={viewMode}
            options={["visual", "code"] as const}
            onChange={onViewModeChange as (view: string) => void}
            ariaLabel="Toggle between visual and code view"
          />
        </div>
        <CardContent className="flex-1 p-0 overflow-hidden relative">
          {viewMode === "visual" ? (
            <GraphCanvasWrapper wizardData={wizardData} />
          ) : (
            <CodeView
              wizardData={wizardData}
              selectedFileId={selectedFileId}
              editedFiles={editedFilesMap}
              onFileSelect={onFileSelect}
              onFileContentChange={onFileContentChange}
              onFileSave={onFileSave}
              editorSlot={(props) => <EditableMonaco {...props} />}
            />
          )}
        </CardContent>
      </Card>
    );
  },
);
