"use client";

import { useCallback } from "react";
import { useTheme } from "@/hooks/useTheme";
import { useCanvasConfig } from "../hooks/useCanvasConfig";
import { useCanvasValidation } from "../hooks/useCanvasValidation";
import { useCanvasExport } from "../hooks/useCanvasExport";
import { CanvasViewport } from "./CanvasViewport";
import type { HexagonCanvasProps, HexagonFlowNode } from "./types";

export function HexagonCanvas({
  nodes,
  edges,
  onNodeDragStop,
  onNodeDoubleClick,
  onExportClick,
}: HexagonCanvasProps) {
  const { theme } = useTheme();
  const colorMode = theme === "dark" ? "dark" : "light";

  const { flowNodes, flowEdges, nodeTypes } = useCanvasConfig(nodes, edges);
  const isValidConnection = useCanvasValidation(nodes);
  useCanvasExport(onExportClick);

  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: HexagonFlowNode) => {
      if (onNodeDragStop) {
        onNodeDragStop({ ...node.data, position: node.position });
      }
    },
    [onNodeDragStop],
  );

  const handleNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: HexagonFlowNode) => {
      if (onNodeDoubleClick) {
        onNodeDoubleClick(node.data);
      }
    },
    [onNodeDoubleClick],
  );

  return (
    <CanvasViewport
      nodes={flowNodes}
      edges={flowEdges}
      nodeTypes={nodeTypes}
      isValidConnection={isValidConnection}
      onNodeDragStop={handleNodeDragStop}
      onNodeDoubleClick={handleNodeDoubleClick}
      colorMode={colorMode}
    />
  );
}
