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
  type ColorMode,
} from "@xyflow/react";
import { toPng } from "html-to-image";
import { useTheme } from "@/hooks/use-theme";
import "@xyflow/react/dist/style.css";

import { HexagonNode } from "./hexagon-node";
import { PeerContextNode } from "./peer-context-node";
import { GroupBoundaryNode } from "./group-boundary-node";
import type {
  HexagonNode as HexagonNodeData,
  HexagonEdge,
} from "@hexagen/visualization";
import type { Result } from "@hexagen/shared";
import type { HexagonNodeWithLayout } from "../../lib/layout-engine";

type HexagonNodeDataRecord = HexagonNodeData & Record<string, unknown>;

type HexagonFlowNode = FlowNode<HexagonNodeDataRecord>;

const nodeTypes = {
  hexagon: HexagonNode,
  peer: PeerContextNode,
  group: GroupBoundaryNode,
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
    const n = node as HexagonNodeWithLayout;

    let nodeType = "hexagon";
    if (n.id === "monorepo-boundary" || n.type === "group") {
      nodeType = "group";
    } else if (n.isPeer || n.type === "peer") {
      nodeType = "peer";
    }

    const flowNode: HexagonFlowNode = {
      id: node.id,
      type: nodeType,
      position: node.position,
      data: node as HexagonNodeDataRecord,
    };

    // Pass parentId for grouping - establishes parent-child relationship
    if (n.parentId) {
      flowNode.parentId = n.parentId;
    }

    // Pass extent to make child position relative to parent
    if (n.extent) {
      flowNode.extent = n.extent;
    }

    // Pass style (width/height) for parent container bounds
    if (n.style) {
      flowNode.style = n.style;
    }

    // Use draggable property from data if present, otherwise default to true
    if (n.draggable === false) {
      flowNode.draggable = false;
    }

    return flowNode;
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
    style:
      edge.label === "SK" ? { strokeWidth: 4, stroke: "#a78bfa" } : undefined,
  }));
}

export function HexagonCanvas({
  nodes,
  edges,
  onNodeDragStop,
  onNodeDoubleClick,
  onExportClick,
}: HexagonCanvasProps) {
  const { theme } = useTheme();
  const colorMode: ColorMode = theme === "dark" ? "dark" : "light";

  // Add timestamp to key to force React Flow to re-render nodes when data changes
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

  const isValidConnection = useCallback(
    (connection: FlowEdge | Connection): boolean => {
      const sourceHandle = connection.sourceHandle ?? "";
      const targetHandle = connection.targetHandle ?? "";

      // Rule 1: Event handles must pair pub_ ↔ sub_ exclusively.
      // Prevents domain event ports from accidentally plugging into cardinal handles.
      const isSourceEvent = sourceHandle.startsWith("pub_");
      const isTargetEvent = targetHandle.startsWith("sub_");
      if (isSourceEvent || isTargetEvent) {
        return isSourceEvent && isTargetEvent;
      }

      // Rule 2: Wizard-generated satellite nodes must connect to their designated
      // cardinal handle on root-core. Manually added nodes (no side) connect freely.
      const targetNode = nodes.find((n) => n.id === connection.target);
      if (targetNode?.id === "root-core") {
        const sourceNode = nodes.find((n) => n.id === connection.source) as
          | HexagonNodeWithLayout
          | undefined;
        const sourceSide = sourceNode?.side;
        return !sourceSide || sourceSide === targetHandle;
      }

      return true;
    },
    [nodes],
  );

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
        isValidConnection={isValidConnection}
        fitView
        colorMode={colorMode}
        className="bg-background"
      >
        <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
        <Controls className="bg-background border-border" />
      </ReactFlow>
    </div>
  );
}
