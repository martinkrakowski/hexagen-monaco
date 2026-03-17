"use client";

import { useCallback, useMemo, useEffect, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  BackgroundVariant,
  type Node as FlowNode,
  type Edge as FlowEdge,
  type Connection,
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
  return nodes.map((node): HexagonFlowNode => {
    const n = node as any;
    return {
      id: node.id,
      type: "hexagon",
      position: node.position,
      data: node as HexagonNodeDataRecord,
      ...(n.parentId
        ? { parentId: n.parentId, extent: n.extent ?? "parent", draggable: false }
        : {}),
    };
  });
}

function mapToFlowEdges(edges: HexagonEdge[]): FlowEdge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: edge.type === "animated" ? "default" : (edge.type ?? "default"),
    animated: edge.type === "animated" || !!edge.animated,
    label: edge.label,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    // SK (Shared Kernel) gets a visually heavier edge to convey tight coupling
    style: edge.label === "SK"
      ? { strokeWidth: 4, stroke: "#a78bfa" }
      : undefined,
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

  const isValidConnection = useCallback(
    (connection: FlowEdge | Connection): boolean => {
      const targetNode = nodes.find((n) => n.id === connection.target);

      // Only enforce rules when connecting to the root core
      if (targetNode?.id !== "root-core") return true;

      const sourceNode = nodes.find((n) => n.id === connection.source);
      // `side` is layout metadata from HexagonNodeWithLayout that rides directly
      // on the node object — not nested under `.data`. The `any` cast is intentional:
      // HexagonCanvas receives HexagonNodeData[], which doesn't include layout fields
      // in its type, even though wizard-generated nodes carry them at runtime.
      const sourceSide = (sourceNode as any)?.side;

      // Manually added nodes (no side) can connect to any handle
      // Wizard-generated nodes must connect to their designated handle
      return !sourceSide || sourceSide === connection.targetHandle;
    },
    [nodes],
  );

  return (
    <div className="w-full h-full min-h-[400px]">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodeDragStop={handleNodeDragStop}
        onNodeDoubleClick={handleNodeDoubleClick}
        isValidConnection={isValidConnection}
        fitView
        className="bg-background"
      >
        <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
        <Controls className="bg-background border-border" />
      </ReactFlow>
    </div>
  );
}
