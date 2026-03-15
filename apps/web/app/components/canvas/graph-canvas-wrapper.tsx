"use client";

import { useState, useCallback } from "react";
import { useCanvasState } from "../../hooks/use-canvas-state";
import { HexagonCanvas, CanvasToolbar, NodeEditorDialog } from "./index";
import type { Result } from "@hexagen/shared";

interface GraphCanvasWrapperProps {
  projectId: string;
}

export function GraphCanvasWrapper({ projectId }: GraphCanvasWrapperProps) {
  const state = useCanvasState(projectId);
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
      console.warn("Export handler not available");
      return;
    }

    const result = await exportHandler();
    if (!result.success) {
      console.error("Export failed:", result.error);
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

  const selectedNode = state.selectedNodeId
    ? state.nodes.find((n) => n.id === state.selectedNodeId)
    : undefined;

  return (
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
        isOpen={!!selectedNode}
        node={selectedNode}
        onClose={state.onCloseEditor}
        onUpdateNode={state.onUpdateNode}
      />
    </div>
  );
}
