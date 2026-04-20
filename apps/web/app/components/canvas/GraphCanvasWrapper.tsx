"use client";

import { useState, useCallback } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { useCanvasState } from "../../hooks/useCanvasState";
import { HexagonCanvas } from "./HexagonCanvas";
import { CanvasToolbar } from "./CanvasToolbar";
import { NodeEditorDialog } from "./NodeEditorDialog";
import type { Result, WizardData } from "@hexagen/shared";

interface GraphCanvasWrapperProps {
  projectId: string;
  wizardData?: WizardData;
}

export function GraphCanvasWrapper({
  projectId,
  wizardData,
}: GraphCanvasWrapperProps) {
  const state = useCanvasState(projectId, wizardData);
  const [exportHandler, setExportHandler] = useState<
    (() => Promise<Result<Blob, Error>>) | null
  >(null);

  const handleExportClick = useCallback(
    (handler: () => Promise<Result<Blob, Error>>) => {
      setExportHandler(() => handler);
    },
    [],
  );

  const handleExport = useCallback(async () => {
    if (!exportHandler) {
      alert("Export is not available in this context");
      return;
    }

    const result = await exportHandler();
    if (!result.success) {
      alert(`Export failed: ${result.error.message}`);
      return;
    }

    const blob = result.value;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `architecture-${new Date().toISOString()}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }, [exportHandler]);

  if ("error" in state) {
    return (
      <div className="flex items-center justify-center w-full h-full min-h-[400px]">
        <div className="text-destructive">
          Failed to load graph: {state.error.message}
        </div>
      </div>
    );
  }

  if (state.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center w-full h-full min-h-[400px] bg-muted/20">
        <div className="text-center text-muted-foreground">
          <p className="text-lg font-medium mb-2">No Architecture Data</p>
          <p className="text-sm">
            Complete the wizard to visualize your project structure
          </p>
        </div>
      </div>
    );
  }

  const selectedNode = state.selectedNodeId
    ? state.nodes.find((n) => n.id === state.selectedNodeId)
    : undefined;

  return (
    <ReactFlowProvider>
      <div className="w-full h-full min-h-[400px] relative">
        <HexagonCanvas
          nodes={state.nodes}
          edges={state.edges}
          onNodeDragStop={state.onNodeDragStop}
          onNodeDoubleClick={state.onNodeDoubleClick}
          onExportClick={handleExportClick}
        />
        <div className="absolute top-4 right-4">
          <CanvasToolbar onAddNode={state.onAddNode} onExport={handleExport} />
        </div>
        <NodeEditorDialog
          key={selectedNode?.id}
          isOpen={!!selectedNode}
          node={selectedNode}
          onClose={state.onCloseEditor}
          onUpdateNode={state.onUpdateNode}
        />
      </div>
    </ReactFlowProvider>
  );
}
