"use client";

import { useCanvasState } from "../../hooks/use-canvas-state";
import { HexagonCanvas, CanvasToolbar } from "./index";

interface GraphCanvasWrapperProps {
  projectId: string;
}

export function GraphCanvasWrapper({ projectId }: GraphCanvasWrapperProps) {
  const state = useCanvasState(projectId);

  if ("error" in state) {
    return (
      <div className="flex items-center justify-center w-full h-full min-h-[400px]">
        <div className="text-destructive">
          Failed to load graph: {state.error.message}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full min-h-[400px] relative">
      <HexagonCanvas
        nodes={state.nodes}
        edges={state.edges}
        onNodeDragStop={state.onNodeDragStop}
        onNodeDoubleClick={state.onNodeDoubleClick}
      />
      <div className="absolute top-4 right-4">
        <CanvasToolbar />
      </div>
    </div>
  );
}
