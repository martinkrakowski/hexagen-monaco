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
import {
  generateHexagonalContextMap,
  type HexagonNodeWithLayout,
} from "../lib/layout-engine";

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
  position = { x: 100, y: 100 },
): HexagonNodeWithLayout {
  return {
    id:
      crypto.randomUUID?.() ??
      `id-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    label,
    type,
    position,
  };
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
    // Clear any previous errors before loading new data
    setError(null);

    // Wizard path: generate strategic context map
    if (wizardData?.boundedContexts?.length) {
      const { nodes, edges } = generateHexagonalContextMap(wizardData);
      setState({
        nodes,
        edges,
        viewport: createCanvasViewport(),
      });
      return;
    }

    // Demo path: load from provider with dagre layout
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

  // Reset error when component mounts or wizard data changes significantly
  useEffect(() => {
    setError(null);
  }, [wizardData?.boundedContexts?.length]);

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
    setState((prev) => {
      // Place new node near existing content — offset from root-core if present,
      // otherwise offset from the first node, otherwise use a fixed fallback.
      const root = prev.nodes.find((n) => n.id === "root-core");
      const anchor = root ?? prev.nodes[0];
      const position = anchor
        ? { x: anchor.position.x + 220, y: anchor.position.y + 220 }
        : { x: 100, y: 100 };
      const newNode = createDefaultHexagonNode("entity", "New Node", position);

      // No auto-edge: manually added nodes have no cardinal side, so connecting
      // them programmatically always defaults to the nearest handle ("north").
      // The user draws the connection manually to choose the correct handle.
      return {
        ...prev,
        nodes: [...prev.nodes, newNode],
        edges: prev.edges,
        selectedNodeId: newNode.id,
      };
    });
  }, []);

  const onExportImage = useCallback(() => {
    // TODO: implement export to PNG/SVG via html-to-image
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
