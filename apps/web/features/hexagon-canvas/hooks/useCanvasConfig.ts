"use client";

import { useMemo } from "react";
import {
  type Node as FlowNode,
  type Edge as FlowEdge,
  type NodeTypes,
  MarkerType,
} from "@xyflow/react";
import { UnifiedBoundedContext } from "../BoundedContext";
import { GroupBoundaryNode } from "../GroupBoundaryNode";
import { PeerContextNode } from "../PeerContextNode";
import type {
  HexagonNode as HexagonNodeData,
  HexagonEdge,
  HexagonNodeWithLayout,
} from "@hexagen/visualization";

type HexagonNodeDataRecord = HexagonNodeData & Record<string, unknown>;
type HexagonFlowNode = FlowNode<HexagonNodeDataRecord>;
type NodeWithVariant = HexagonNodeData & {
  variant?: { hexColor?: string };
};

export const nodeTypes: NodeTypes = {
  hexagon: UnifiedBoundedContext,
  inner: UnifiedBoundedContext,
  peer: PeerContextNode,
  group: GroupBoundaryNode,
} as unknown as NodeTypes;

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

    if (n.parentId) flowNode.parentId = n.parentId;
    if (n.extent) flowNode.extent = n.extent;
    if (n.style) flowNode.style = n.style;

    flowNode.draggable = n.id === "monorepo-boundary" ? false : true;

    const satelliteTypes = ["entity", "use-case", "adapter", "port"];
    if (n.type && satelliteTypes.includes(n.type)) {
      flowNode.zIndex = 10;
    }

    return flowNode;
  });
}

function getEdgeColor(sourceNode: HexagonNodeData | undefined): string {
  if (
    sourceNode?.type === "port" &&
    (sourceNode as NodeWithVariant).variant?.hexColor
  ) {
    return (sourceNode as NodeWithVariant).variant!.hexColor!;
  }
  return "hsl(var(--foreground) / 0.35)";
}

function mapToFlowEdges(
  edges: HexagonEdge[],
  nodes: HexagonNodeData[],
): FlowEdge[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  return edges.map((edge) => {
    const isSK = edge.isSharedKernel === true;
    const sourceNode = nodeMap.get(edge.source);
    const edgeColor = isSK
      ? "hsl(var(--shared-kernel-edge))"
      : getEdgeColor(sourceNode);

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

export interface CanvasConfig {
  flowNodes: HexagonFlowNode[];
  flowEdges: FlowEdge[];
  nodeTypes: NodeTypes;
}

export function useCanvasConfig(
  nodes: HexagonNodeData[],
  edges: HexagonEdge[],
): CanvasConfig {
  const flowNodes = useMemo(() => mapToFlowNodes(nodes), [nodes]);
  const flowEdges = useMemo(() => mapToFlowEdges(edges, nodes), [edges, nodes]);

  return { flowNodes, flowEdges, nodeTypes };
}
