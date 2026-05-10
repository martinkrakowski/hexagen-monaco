"use client";

import { useMemo, useRef } from "react";
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

function toFlowNode(node: HexagonNodeData): HexagonFlowNode {
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
}

/**
 * Identity-preserving FlowNode mapping. When a Zustand store update changes
 * the `nodes` array reference (e.g. on node drag), only nodes whose
 * underlying HexagonNode reference has changed get a new FlowNode — the rest
 * reuse their previous FlowNode object. This allows React.memo on custom node
 * components to skip re-rendering unchanged nodes.
 *
 * Returns the updated cache so the caller can persist it across renders.
 */
function mapToFlowNodes(
  nodes: HexagonNodeData[],
  cache: Map<string, { source: HexagonNodeData; flow: HexagonFlowNode }>,
): {
  flowNodes: HexagonFlowNode[];
  nextCache: Map<string, { source: HexagonNodeData; flow: HexagonFlowNode }>;
} {
  const nextCache = new Map<
    string,
    { source: HexagonNodeData; flow: HexagonFlowNode }
  >();
  const flowNodes: HexagonFlowNode[] = [];

  for (const node of nodes) {
    const cached = cache.get(node.id);
    if (cached && cached.source === node) {
      flowNodes.push(cached.flow);
      nextCache.set(node.id, cached);
    } else {
      const flow = toFlowNode(node);
      flowNodes.push(flow);
      nextCache.set(node.id, { source: node, flow });
    }
  }

  return { flowNodes, nextCache };
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

function mapToFlowEdge(
  edge: HexagonEdge,
  sourceNode: HexagonNodeData | undefined,
): FlowEdge {
  const isSK = edge.isSharedKernel === true;
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
}

/**
 * Identity-preserving FlowEdge mapping. Same principle as mapToFlowNodes —
 * unchanged edges reuse their previous FlowEdge object so React.memo on
 * custom edge components can skip re-renders.
 *
 * Returns the updated cache so the caller can persist it across renders.
 */
function mapToFlowEdges(
  edges: HexagonEdge[],
  nodes: HexagonNodeData[],
  cache: Map<string, { source: HexagonEdge; flow: FlowEdge }>,
): {
  flowEdges: FlowEdge[];
  nextCache: Map<string, { source: HexagonEdge; flow: FlowEdge }>;
} {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const nextCache = new Map<string, { source: HexagonEdge; flow: FlowEdge }>();
  const flowEdges: FlowEdge[] = [];

  for (const edge of edges) {
    const cached = cache.get(edge.id);
    const sourceNode = nodeMap.get(edge.source);
    if (cached && cached.source === edge) {
      flowEdges.push(cached.flow);
      nextCache.set(edge.id, cached);
    } else {
      const flow = mapToFlowEdge(edge, sourceNode);
      flowEdges.push(flow);
      nextCache.set(edge.id, { source: edge, flow });
    }
  }

  return { flowEdges, nextCache };
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
  const nodeCacheRef = useRef<
    Map<string, { source: HexagonNodeData; flow: HexagonFlowNode }>
  >(new Map());
  const edgeCacheRef = useRef<
    Map<string, { source: HexagonEdge; flow: FlowEdge }>
  >(new Map());

  const flowNodes = useMemo(() => {
    const result = mapToFlowNodes(nodes, nodeCacheRef.current);
    nodeCacheRef.current = result.nextCache;
    return result.flowNodes;
  }, [nodes]);

  const flowEdges = useMemo(() => {
    const result = mapToFlowEdges(edges, nodes, edgeCacheRef.current);
    edgeCacheRef.current = result.nextCache;
    return result.flowEdges;
  }, [edges, nodes]);

  return { flowNodes, flowEdges, nodeTypes };
}
