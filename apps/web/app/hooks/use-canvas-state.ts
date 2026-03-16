import { useState, useCallback, useEffect } from "react";
import dagre from "@dagrejs/dagre";
import type {
  HexagonNode,
  HexagonNodeType,
  HexagonEdge,
  CanvasViewport,
} from "@hexagen/visualization";
import {
  RenderHexagonCanvasUseCase,
  createCanvasViewport,
} from "@hexagen/visualization";
import { getArchitectureGraphProvider } from "../lib/wire";
import type { WizardData } from "@hexagen/shared";

interface GraphState {
  nodes: HexagonNode[];
  edges: HexagonEdge[];
  viewport: CanvasViewport;
  selectedNodeId?: string;
}

interface UseCanvasStateResult extends Omit<GraphState, "selectedNodeId"> {
  selectedNodeId?: string;
  onNodeDragStop: (node: HexagonNode) => void;
  onNodeDoubleClick: (node: HexagonNode) => void;
  onAddNode: () => void;
  onExportImage: () => void;
  onUpdateNode: (
    nodeId: string,
    updates: Pick<HexagonNode, "label" | "type">,
  ) => void;
  onCloseEditor: () => void;
}

interface UseCanvasStateError {
  error: Error;
}

function applyDagreLayout(
  nodes: HexagonNode[],
  edges: HexagonEdge[],
): HexagonNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 80, ranksep: 100 });
  g.setDefaultEdgeLabel(() => ({}));

  const nodeWidth = 180;
  const nodeHeight = 100;

  nodes.forEach((node) => {
    g.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  return nodes.map((node) => {
    const layoutNode = g.node(node.id);
    return {
      ...node,
      position: {
        x: layoutNode.x - nodeWidth / 2,
        y: layoutNode.y - nodeHeight / 2,
      },
    };
  });
}

function createDefaultHexagonNode(
  type: HexagonNodeType = "entity",
  label: string = "New Node",
): HexagonNode {
  return {
    id:
      crypto.randomUUID?.() ??
      `id-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    label,
    type,
    position: { x: 0, y: 0 },
  };
}

/**
 * Layout constants for the 3-ring radial canvas.
 *
 * NODE_W / NODE_H match the fixed pixel dimensions in hexagon-node.tsx.
 *
 * INNER_RADIUS: distance from origin to ring-1 centres. 220px gives ~80px
 * of clear space around the 120×100 center node at typical zoom levels.
 *
 * OUTER_RADIUS_BASE: minimum distance for ring-2 (ports). 430px keeps port
 * labels readable without overlapping ring-1 nodes.
 *
 * OUTER_RADIUS_PER_NODE: incremental radius added per outer node so that
 * angular spacing stays ≥ ~node height. Derived from: min arc = NODE_H →
 * spacing_px = NODE_H + 8px gap ≈ 108 → r = spacing_px * count / (2π) →
 * simplified to 38px/node which satisfies the constraint up to ~20 nodes.
 */
const RADIAL_LAYOUT_CONFIG = {
  NODE_W: 120,
  NODE_H: 100,
  INNER_RADIUS: 220,
  OUTER_RADIUS_BASE: 430,
  OUTER_RADIUS_PER_NODE: 38,
} as const;

function applyRadialLayout(
  nodes: HexagonNode[],
  innerIds: Set<string>,
  outerIds: Set<string>,
): HexagonNode[] {
  const {
    NODE_W,
    NODE_H,
    INNER_RADIUS,
    OUTER_RADIUS_BASE,
    OUTER_RADIUS_PER_NODE,
  } = RADIAL_LAYOUT_CONFIG;
  const OUTER_RADIUS = Math.max(
    OUTER_RADIUS_BASE,
    outerIds.size * OUTER_RADIUS_PER_NODE,
  );

  const innerNodes = nodes.filter((n) => innerIds.has(n.id));
  const outerNodes = nodes.filter((n) => outerIds.has(n.id));
  const centerNode = nodes.find(
    (n) => !innerIds.has(n.id) && !outerIds.has(n.id),
  );

  const positionOnRing = (i: number, total: number, radius: number) => {
    const angle = (2 * Math.PI * i) / total - Math.PI / 2;
    return {
      x: Math.cos(angle) * radius - NODE_W / 2,
      y: Math.sin(angle) * radius - NODE_H / 2,
    };
  };

  return nodes.map((node) => {
    if (centerNode?.id === node.id)
      return { ...node, position: { x: -NODE_W / 2, y: -NODE_H / 2 } };
    const ii = innerNodes.findIndex((n) => n.id === node.id);
    if (ii !== -1)
      return {
        ...node,
        position: positionOnRing(ii, innerNodes.length, INNER_RADIUS),
      };
    const oi = outerNodes.findIndex((n) => n.id === node.id);
    if (oi !== -1)
      return {
        ...node,
        position: positionOnRing(oi, outerNodes.length, OUTER_RADIUS),
      };
    // Guard: node belongs to neither ring — invariant violation, log and leave in place
    console.warn(
      `[applyRadialLayout] Node "${node.id}" not in innerIds or outerIds; position unchanged`,
    );
    return node;
  });
}

export function useCanvasState(
  projectId: string,
  wizardData?: WizardData,
): UseCanvasStateResult | UseCanvasStateError {
  const [state, setState] = useState<GraphState>({
    nodes: [],
    edges: [],
    viewport: createCanvasViewport(),
  });
  const [error, setError] = useState<Error | null>(null);

  const loadGraph = useCallback(async () => {
    // If wizard data with a root name exists, use radial layout
    if (wizardData?.rootName?.trim()) {
      const nodes: HexagonNode[] = [];
      const edges: HexagonEdge[] = [];
      const innerIds = new Set<string>();
      const outerIds = new Set<string>();

      const centerId = "node-bounded-context";
      nodes.push({
        id: centerId,
        label: wizardData.rootName.trim(),
        type: "bounded-context",
        position: { x: 0, y: 0 },
      });

      const sanitize = (values: string[] | undefined) =>
        (values ?? []).map((v) => v.trim()).filter(Boolean);

      // Inner ring: entities
      sanitize(wizardData.entities).forEach((entity, i) => {
        const id = `node-entity-${i}`;
        nodes.push({
          id,
          label: entity,
          type: "entity",
          position: { x: 0, y: 0 },
        });
        innerIds.add(id);
        edges.push({
          id: `edge-${centerId}-${id}`,
          source: centerId,
          target: id,
          type: "default",
        });
      });

      // Inner ring: use-cases
      sanitize(wizardData.useCases).forEach((uc, i) => {
        const id = `node-usecase-${i}`;
        nodes.push({
          id,
          label: uc,
          type: "use-case",
          position: { x: 0, y: 0 },
        });
        innerIds.add(id);
        edges.push({
          id: `edge-${centerId}-${id}`,
          source: centerId,
          target: id,
          type: "default",
        });
      });

      // Outer ring: single-value adapters — trim and skip empty/whitespace/"None"
      const sanitizeScalar = (v: string | undefined) => {
        const s = v?.trim();
        return s && s !== "None" ? s : undefined;
      };

      [
        { key: "api", value: sanitizeScalar(wizardData.apiFramework) },
        { key: "ui", value: sanitizeScalar(wizardData.uiFramework) },
        {
          key: "persistence",
          value: sanitizeScalar(wizardData.persistenceAdapter),
        },
        {
          key: "messaging",
          value: sanitizeScalar(wizardData.messagingAdapter),
        },
        {
          key: "telemetry",
          value: sanitizeScalar(wizardData.telemetryProvider),
        },
      ].forEach(({ key, value }) => {
        if (!value) return;
        const id = `node-port-${key}`;
        nodes.push({
          id,
          label: value,
          type: "port",
          position: { x: 0, y: 0 },
        });
        outerIds.add(id);
        edges.push({
          id: `edge-${centerId}-${id}`,
          source: centerId,
          target: id,
          type: "default",
        });
      });

      // Outer ring: array-valued ports
      [
        { prefix: "ext", values: sanitize(wizardData.externalApiPorts) },
        { prefix: "llm", values: sanitize(wizardData.llmProviders) },
        {
          prefix: "blockchain",
          values: sanitize(wizardData.blockchainNetworks),
        },
      ].forEach(({ prefix, values }) => {
        values.forEach((val, i) => {
          const id = `node-port-${prefix}-${i}`;
          nodes.push({
            id,
            label: val,
            type: "port",
            position: { x: 0, y: 0 },
          });
          outerIds.add(id);
          edges.push({
            id: `edge-${centerId}-${id}`,
            source: centerId,
            target: id,
            type: "default",
          });
        });
      });

      setState({
        nodes: applyRadialLayout(nodes, innerIds, outerIds),
        edges,
        viewport: createCanvasViewport(),
      });
      return;
    }

    // Fall back to demo data from provider
    const provider = getArchitectureGraphProvider();
    const result = await provider.getArchitectureGraph(projectId);

    if (result.success === false) {
      setError(result.error);
      return;
    }

    const { nodes, edges } = result.data;
    const laidOutNodes = applyDagreLayout(nodes, edges);

    const useCase = new RenderHexagonCanvasUseCase();
    const renderResult = await useCase.render({
      canvasId: projectId,
      nodes: laidOutNodes,
      edges,
    });

    setState({
      nodes: laidOutNodes,
      edges,
      viewport: renderResult.viewport,
    });
  }, [projectId, wizardData]);

  useEffect(() => {
    loadGraph();
  }, [loadGraph, wizardData]);

  const onNodeDragStop = useCallback((node: HexagonNode) => {
    setState((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) =>
        n.id === node.id ? { ...n, position: node.position } : n,
      ),
    }));
  }, []);

  const onNodeDoubleClick = useCallback((node: HexagonNode) => {
    setState((prev) => ({ ...prev, selectedNodeId: node.id }));
  }, []);

  const onAddNode = useCallback(() => {
    const newNode = createDefaultHexagonNode();
    setState((prev) => ({
      ...prev,
      nodes: [...prev.nodes, newNode],
      selectedNodeId: newNode.id,
    }));
  }, []);

  const onExportImage = useCallback(() => {
    console.warn("[onExportImage] Not implemented yet");
  }, []);

  const onUpdateNode = useCallback(
    (nodeId: string, updates: Pick<HexagonNode, "label" | "type">) => {
      setState((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) =>
          n.id === nodeId ? { ...n, ...updates } : n,
        ),
      }));
    },
    [],
  );

  const onCloseEditor = useCallback(() => {
    setState((prev) => ({ ...prev, selectedNodeId: undefined }));
  }, []);

  if (error) {
    return { error };
  }

  return {
    nodes: state.nodes,
    edges: state.edges,
    viewport: state.viewport,
    selectedNodeId: state.selectedNodeId,
    onNodeDragStop,
    onNodeDoubleClick,
    onAddNode,
    onExportImage,
    onUpdateNode,
    onCloseEditor,
  };
}
