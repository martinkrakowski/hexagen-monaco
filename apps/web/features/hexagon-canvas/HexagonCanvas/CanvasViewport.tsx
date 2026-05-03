"use client";

import {
  ReactFlow,
  Background,
  Controls,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { CanvasViewportProps } from "./types";

export function CanvasViewport({
  nodes,
  edges,
  nodeTypes: nodeTypesMap,
  isValidConnection,
  onNodeDragStop,
  onNodeDoubleClick,
  colorMode,
}: CanvasViewportProps) {
  const theme = colorMode === "dark" ? "dark" : "light";
  const bgColor = `hsl(${
    getComputedStyle(document.documentElement)
      .getPropertyValue("--muted-foreground")
      .trim() || (theme === "dark" ? "35 5% 35%" : "35 5% 65%")
  } / 0.4)`;

  return (
    <div className="w-full h-full min-h-96">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypesMap}
        onNodeDragStop={onNodeDragStop}
        onNodeDoubleClick={onNodeDoubleClick}
        isValidConnection={isValidConnection}
        fitView
        colorMode={colorMode}
        className="bg-card"
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1.5}
          color={bgColor}
          style={{ opacity: 0.8 }}
        />
        <Controls className="bg-card border border-border shadow-md rounded-lg [&_.react-flow__controls-button]:border-border [&_.react-flow__controls-button]:bg-card [&_.react-flow__controls-button]:text-foreground" />
      </ReactFlow>
    </div>
  );
}
