import React, { useMemo } from "react";
import { Card, CardContent } from "@hexagen/ui";
import { ViewToggle } from "@hexagen/ui";
import { GraphCanvasWrapper } from "../hexagon-canvas/GraphCanvasWrapper";
import { CodeView } from "../code-view/CodeView";
import { EditableMonaco } from "../monaco-editor/EditableMonaco";
import { useWizardData } from "./contexts/WizardLifecycleContext";
import { useEditorPush } from "./hooks/useEditorPush";
import { useActiveWorkspace } from "@/contexts/ActiveWorkspaceContext";

import type { ViewMode } from "@/types/view-mode";

interface ArchitecturePreviewPaneProps {
  viewMode: ViewMode;
  selectedFileId: string | null;
  editedFiles: Record<string, string>;
  unpushed: boolean;
  onViewModeChange: (mode: ViewMode) => void;
  onFileSelect: (fileId: string | null) => void;
  onFileContentChange: (fileId: string, content: string) => void;
  onFileSave: (fileId: string) => void;
  onPushed: () => void;
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
    viewMode,
    selectedFileId,
    editedFiles,
    unpushed,
    onViewModeChange,
    onFileSelect,
    onFileContentChange,
    onFileSave,
    onPushed,
  }: ArchitecturePreviewPaneProps) {
    const wizardData = useWizardData();
    const { activeWorkspace } = useActiveWorkspace();
    const editedFilesMap = useMemo(
      () => recordToMap(editedFiles),
      [editedFiles],
    );

    const { onPush, canPush, isPushing, connectedRepo, pushError } =
      useEditorPush({
        projectId: activeWorkspace?.projectId ?? null,
        files: editedFiles,
        unpushed,
        onPushed,
      });

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
            <>
              <CodeView
                wizardData={wizardData}
                selectedFileId={selectedFileId}
                editedFiles={editedFilesMap}
                onFileSelect={onFileSelect}
                onFileContentChange={onFileContentChange}
                onFileSave={onFileSave}
                editorSlot={(props) => (
                  <EditableMonaco
                    {...props}
                    onPush={onPush}
                    canPush={canPush}
                    isPushing={isPushing}
                    connectedRepo={connectedRepo}
                  />
                )}
              />
              {pushError && (
                <div
                  role="alert"
                  className="absolute bottom-0 inset-x-0 px-4 py-2 text-xs text-destructive bg-destructive/10 border-t border-destructive/20"
                >
                  {pushError}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    );
  },
);
