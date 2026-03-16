"use client";

import { useCallback, useMemo, useEffect, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  BackgroundVariant,
  type Node as FlowNode,
  type Edge as FlowEdge,
} from "@xyflow/react";
import { toPng } from "html-to-image";
import "@xyflow/react/dist/style.css";

import { HexagonNode } from "./hexagon-node";
import type {
  HexagonNode as HexagonNodeData,
  HexagonEdge,
} from "@hexagen/visualization";
import type { Result } from "@hexagen/shared";

type HexagonNodeDataRecord = HexagonNodeData & Record<string, unknown>;

type HexagonFlowNode = FlowNode<HexagonNodeDataRecord>;

const nodeTypes = {
  hexagon: HexagonNode,
};

export interface HexagonCanvasProps {
  nodes: HexagonNodeData[];
  edges: HexagonEdge[];
  onNodeDragStop?: (node: HexagonNodeData) => void;
  onNodeDoubleClick?: (node: HexagonNodeData) => void;
  onExportClick?: (handler: () => Promise<Result<Blob, Error>>) => void;
}

function mapToFlowNodes(nodes: HexagonNodeData[]): HexagonFlowNode[] {
  return nodes.map(
    (node): HexagonFlowNode => ({
      id: node.id,
      type: "hexagon",
      position: node.position,
      data: node as HexagonNodeDataRecord,
    }),
  );
}

function mapToFlowEdges(edges: HexagonEdge[]): FlowEdge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    animated: edge.type === "animated",
    label: edge.label,
  }));
}

export function HexagonCanvas({
  nodes,
  edges,
  onNodeDragStop,
  onNodeDoubleClick,
  onExportClick,
}: HexagonCanvasProps) {
  const flowNodes = useMemo(() => mapToFlowNodes(nodes), [nodes]);
  const flowEdges = useMemo(() => mapToFlowEdges(edges), [edges]);

  const initialExportDone = useRef(false);

  const handleExportClick = useCallback(async (): Promise<
    Result<Blob, Error>
  > => {
    try {
      const viewport = document.querySelector(
        ".react-flow__viewport",
      ) as HTMLElement | null;
      if (!viewport) {
        return { success: false, error: new Error("Viewport not found") };
      }

      const dataUrl = await toPng(viewport, {
        backgroundColor: "#ffffff",
        pixelRatio: 2,
      });

      const response = await fetch(dataUrl);
      const blob = await response.blob();
      return { success: true, value: blob };
    } catch (err) {
      return { success: false, error: err as Error };
    }
  }, []);

  useEffect(() => {
    if (onExportClick && !initialExportDone.current) {
      initialExportDone.current = true;
      onExportClick(handleExportClick);
    }
  }, [onExportClick, handleExportClick]);

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
