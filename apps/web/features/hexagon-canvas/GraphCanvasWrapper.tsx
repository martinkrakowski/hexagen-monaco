"use client";

import { ReactFlowProvider } from "@xyflow/react";
import { useCanvasState } from "./hooks/useCanvasState";
import { useCanvasViewportManager } from "./hooks/use-canvas-viewport-manager";
import { useCanvasHistoryController } from "./hooks/use-canvas-history-controller";
import { HexagonCanvas } from "./HexagonCanvas";
import { CanvasToolbar } from "./CanvasToolbar";
import { NodeEditorDialog } from "./NodeEditorDialog";
import type { WizardData } from "@hexagen/project-configuration";
import type { Result } from "@hexagen/shared";
import { useState, useCallback } from "react";

interface GraphCanvasWrapperProps {
  projectId?: string;
  wizardData?: WizardData;
}

function GraphCanvasInner({ projectId, wizardData }: GraphCanvasWrapperProps) {
  const state = useCanvasState(projectId, wizardData);
  const { undo, redo, canUndo, canRedo } = useCanvasHistoryController();
  const { shouldFitViewRef } = useCanvasViewportManager({ state });
  const [exportHandler, setExportHandler] = useState<
    (() => Promise<Result<Blob, Error>>) | null
  >(null);

  const handleExportClick = useCallback(
    (handler: () => Promise<Result<Blob, Error>>) => {
      setExportHandler(() => handler);
    },
    [],
  );

  const onExport = useCallback(async () => {
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

  const handleUndo = useCallback(() => {
    undo();
    shouldFitViewRef.current = true;
  }, [undo, shouldFitViewRef]);

  const handleRedo = useCallback(() => {
    redo();
    shouldFitViewRef.current = true;
  }, [redo, shouldFitViewRef]);

  const handleCleanup = useCallback(async () => {
    if ("error" in state) return;
    await state.clearCanvasLayout();
    shouldFitViewRef.current = true;
  }, [state, shouldFitViewRef]);

  if ("error" in state) {
    return (
      <div className="flex items-center justify-center w-full h-full min-h-96">
        <div className="text-destructive">
          Failed to load graph: {state.error.message}
        </div>
      </div>
    );
  }

  if (state.nodes.length === 0 && !state.isLayoutCalculating) {
    return (
      <div className="flex items-center justify-center w-full h-full min-h-96 bg-muted/20">
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
    <div className="w-full h-full min-h-96 flex flex-col">
      <CanvasToolbar
        onAddNode={state.onAddNode}
        onExport={onExport}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onCleanup={handleCleanup}
        canUndo={canUndo}
        canRedo={canRedo}
        isCalculating={state.isLayoutCalculating}
      />
      <div className="flex-1 relative">
        <HexagonCanvas
          nodes={state.nodes}
          edges={state.edges}
          onNodeDragStop={state.onNodeDragStop}
          onNodeDoubleClick={state.onNodeDoubleClick}
          onExportClick={handleExportClick}
        />
        <NodeEditorDialog
          key={selectedNode?.id}
          isOpen={!!selectedNode}
          node={selectedNode}
          onClose={state.onCloseEditor}
          onUpdateNode={state.onUpdateNode}
        />
      </div>
    </div>
  );
}

export function GraphCanvasWrapper({
  projectId,
  wizardData,
}: GraphCanvasWrapperProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner projectId={projectId} wizardData={wizardData} />
    </ReactFlowProvider>
  );
}
