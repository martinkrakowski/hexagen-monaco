import { useMemo } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@hexagen/ui";
import { ViewToggle } from "@hexagen/ui";
import { GraphCanvasWrapper } from "../hexagon-canvas/GraphCanvasWrapper";
import { CodeView } from "../code-view/CodeView";
import { EditableMonaco } from "../monaco-editor/EditableMonaco";

import type { WizardData } from "@hexagen/shared";

interface ArchitecturePreviewPaneProps {
  wizardData: WizardData;
  viewMode: "visual" | "code";
  selectedFileId: string | null;
  editedFiles: Record<string, string>;
  onViewModeChange: (mode: "visual" | "code") => void;
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

export function ArchitecturePreviewPane({
  wizardData,
  viewMode,
  selectedFileId,
  editedFiles,
  onViewModeChange,
  onFileSelect,
  onFileContentChange,
  onFileSave,
}: ArchitecturePreviewPaneProps) {
  const editedFilesMap = useMemo(() => recordToMap(editedFiles), [editedFiles]);

  return (
    <Card className="h-full border-0 rounded-none overflow-hidden flex flex-col bg-card">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-border bg-card/30 shrink-0 h-12 px-4 py-3">
        <CardTitle className="text-sm font-semibold">
          Architecture Preview
        </CardTitle>
        <ViewToggle view={viewMode} onChange={onViewModeChange} />
      </CardHeader>
      <CardContent className="flex-1 p-0 overflow-hidden relative">
        {viewMode === "visual" ? (
          <GraphCanvasWrapper projectId="demo" wizardData={wizardData} />
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
}
