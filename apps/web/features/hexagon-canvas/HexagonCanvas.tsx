"use client";

import { useCallback, useMemo, useEffect, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  BackgroundVariant,
  MarkerType,
  type Node as FlowNode,
  type Edge as FlowEdge,
  type Connection,
  type ColorMode,
} from "@xyflow/react";
import { toPng } from "html-to-image";
import { useTheme } from "@/hooks/useTheme";
import "@xyflow/react/dist/style.css";

import { UnifiedBoundedContext } from "./BoundedContext";
import { GroupBoundaryNode } from "./GroupBoundaryNode";
import { PeerContextNode } from "./PeerContextNode";
import {
  CvaVariantResolverAdapter,
  type VisualVariantCategory,
} from "@hexagen/ui-projection-compiler";
import type {
  HexagonNode as HexagonNodeData,
  HexagonEdge,
} from "@hexagen/visualization";
import type { Result } from "@hexagen/shared";
import type { HexagonNodeWithLayout } from "@hexagen/visualization";

type HexagonNodeDataRecord = HexagonNodeData & Record<string, unknown>;

type HexagonFlowNode = FlowNode<HexagonNodeDataRecord>;

const nodeTypes = {
  hexagon: UnifiedBoundedContext,
  inner: UnifiedBoundedContext,
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

    let nodeType: "hexagon" | "inner" | "peer" | "group";
    if (n.id === "monorepo-boundary" || n.type === "group") {
      nodeType = "group";
    } else if (n.isPeer || n.type === "peer") {
      nodeType = "peer";
    } else if (n.type === "inner") {
      nodeType = "inner";
    } else {
      nodeType = "hexagon";
    }

    const flowNode: HexagonFlowNode = {
      id: node.id,
      type: nodeType,
      position: node.position,
      data: node as HexagonNodeDataRecord,
    };

    if (n.parentId) {
      flowNode.parentId = n.parentId;
    }

    if (n.extent) {
      flowNode.extent = n.extent;
    }

    if (n.style) {
      flowNode.style = n.style;
    }

    flowNode.draggable = n.id === "monorepo-boundary" ? false : true;

    // Entity and use-case satellite nodes must render above edge lines so that
    // connecting lines from parent to deeper children do not visually pass
    // through shallower sibling nodes.
    const satelliteTypes = ["entity", "use-case", "adapter", "port"];
    if (n.type && satelliteTypes.includes(n.type)) {
      flowNode.zIndex = 10;
    }

    return flowNode;
  });
}

const edgeVariantResolver = new CvaVariantResolverAdapter();

const EDGE_COLOR_CATEGORIES: readonly VisualVariantCategory[] = [
  "driving",
  "driven",
  "presentation",
  "infrastructure",
] as const;

function isEdgeColorCategory(key: string): key is VisualVariantCategory {
  return (EDGE_COLOR_CATEGORIES as readonly string[]).includes(key);
}

function getEdgeColor(
  sourceNode: HexagonNodeData | undefined,
  isSK: boolean,
): string {
  if (isSK) return "#a78bfa";

  if (sourceNode?.type === "port") {
    const nodeWithCategory = sourceNode as HexagonNodeData & {
      category?: string;
    };
    if (nodeWithCategory.category) {
      const categoryKey = nodeWithCategory.category.toLowerCase();
      if (isEdgeColorCategory(categoryKey)) {
        return edgeVariantResolver.resolve(categoryKey).hexColor;
      }
    }
  }

  return "hsl(var(--foreground) / 0.35)";
}

function mapToFlowEdges(
  edges: HexagonEdge[],
  nodes: HexagonNodeData[],
): FlowEdge[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  return edges.map((edge) => {
    const isSK = edge.label === "SK";
    const sourceNode = nodeMap.get(edge.source);
    const edgeColor = getEdgeColor(sourceNode, isSK);

    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: edge.type === "animated" ? "default" : (edge.type ?? "smoothstep"),
      animated: edge.type === "animated" || !!edge.animated,
      label: edge.label,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      style: isSK
        ? { strokeWidth: 3, stroke: edgeColor }
        : { strokeWidth: 1.5, stroke: edgeColor },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 14,
        height: 14,
        color: edgeColor,
      },
    };
  });
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

  const flowNodes = useMemo(() => mapToFlowNodes(nodes), [nodes]);
  const flowEdges = useMemo(() => mapToFlowEdges(edges, nodes), [edges, nodes]);

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

      const bgChannels = getComputedStyle(document.documentElement)
        .getPropertyValue("--background")
        .trim();
      const backgroundColor = bgChannels ? `hsl(${bgChannels})` : "#ffffff";

      const dataUrl = await toPng(viewport, {
        backgroundColor,
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

      const isSourceEvent = sourceHandle.startsWith("pub_");
      const isTargetEvent = targetHandle.startsWith("sub_");
      if (isSourceEvent || isTargetEvent) {
        return isSourceEvent && isTargetEvent;
      }

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
        className="bg-card"
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1.5}
          color={`hsl(${
            getComputedStyle(document.documentElement)
              .getPropertyValue("--muted-foreground")
              .trim() || (theme === "dark" ? "35 5% 35%" : "35 5% 65%")
          } / 0.4)`}
          style={{ opacity: 0.8 }}
        />
        <Controls className="bg-card border border-border shadow-md rounded-lg [&_.react-flow__controls-button]:border-border [&_.react-flow__controls-button]:bg-card [&_.react-flow__controls-button]:text-foreground" />
      </ReactFlow>
    </div>
  );
}
