"use client";

import { useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  BackgroundVariant,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { HexagonNode } from "./hexagon-node";
import type {
  HexagonNode as HexagonNodeType,
  HexagonEdge,
} from "@hexagen/visualization";

const nodeTypes = {
  hexagon: HexagonNode,
};

export interface HexagonCanvasProps {
  nodes: HexagonNodeType[];
  edges: HexagonEdge[];
  onNodeDragStop?: (node: HexagonNodeType) => void;
  onNodeDoubleClick?: (node: HexagonNodeType) => void;
}

function mapToFlowNodes(nodes: HexagonNodeType[]): Node[] {
  return nodes.map((node) => ({
    id: node.id,
    type: "hexagon",
    position: node.position,
    data: node,
  })) as unknown as Node[];
}

function mapToFlowEdges(edges: HexagonEdge[]): Edge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: edge.type === "animated" ? "default" : undefined,
    label: edge.label,
  })) as unknown as Edge[];
}

export function HexagonCanvas({
  nodes,
  edges,
  onNodeDragStop,
  onNodeDoubleClick,
}: HexagonCanvasProps) {
  const flowNodes = mapToFlowNodes(nodes);
  const flowEdges = mapToFlowEdges(edges);

  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (onNodeDragStop && node.data) {
        onNodeDragStop(node.data as unknown as HexagonNodeType);
      }
    },
    [onNodeDragStop],
  );

  const handleNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (onNodeDoubleClick && node.data) {
        onNodeDoubleClick(node.data as unknown as HexagonNodeType);
      }
    },
    [onNodeDoubleClick],
  );

  return (
    <div className="w-full h-full min-h-[400px]">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodeDragStop={handleNodeDragStop}
        onNodeDoubleClick={handleNodeDoubleClick}
        fitView
        className="bg-background"
      >
        <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
        <Controls className="bg-background border-border" />
      </ReactFlow>
    </div>
  );
}
