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
import { useCanvasLayout } from "./use-canvas-layout";

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
  clearCanvasLayout: () => void;
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

  const {
    nodePositions,
    isLoaded: layoutLoaded,
    updateNodePosition,
    clearLayout,
  } = useCanvasLayout();

  const applySavedPositions = useCallback(
    (nodes: HexagonNode[]): HexagonNode[] => {
      if (!layoutLoaded || Object.keys(nodePositions).length === 0) {
        return nodes;
      }
      return nodes.map((node) => {
        const savedPosition = nodePositions[node.id];
        if (savedPosition) {
          return { ...node, position: savedPosition };
        }
        return node;
      });
    },
    [nodePositions, layoutLoaded],
  );

  const loadGraph = useCallback(async () => {
    setError(null);

    if (!layoutLoaded) {
      return;
    }

    if (wizardData?.boundedContexts?.length) {
      const { nodes, edges } = generateHexagonalContextMap(wizardData);
      const nodesWithPositions = applySavedPositions(nodes);
      setState({
        nodes: nodesWithPositions,
        edges,
        viewport: createCanvasViewport(),
      });
      return;
    }

    const provider = getArchitectureGraphProvider();
    const result = await provider.getArchitectureGraph(projectId);

    if (result.success === false) {
      setError(result.error);
      return;
    }

    const { nodes, edges } = result.data;
    const laidOutNodes = applyDagreLayout(nodes, edges);
    const nodesWithPositions = applySavedPositions(laidOutNodes);

    const useCase = new RenderHexagonCanvasUseCase();
    const renderResult = await useCase.render({
      canvasId: projectId,
      nodes: nodesWithPositions,
      edges,
    });

    setState({
      nodes: nodesWithPositions,
      edges,
      viewport: renderResult.viewport,
    });
  }, [projectId, layoutLoaded, wizardData, applySavedPositions]);

  useEffect(() => {
    setError(null);
  }, [wizardData?.boundedContexts?.length]);

  useEffect(() => {
    if (layoutLoaded) {
      loadGraph();
    }
  }, [layoutLoaded, wizardData, loadGraph]);

  const onNodeDragStop = useCallback(
    (node: HexagonNode) => {
      updateNodePosition(node.id, node.position);
      setState((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) =>
          n.id === node.id ? { ...n, position: node.position } : n,
        ),
      }));
    },
    [updateNodePosition],
  );

  const onNodeDoubleClick = useCallback((node: HexagonNode) => {
    setState((prev) => ({ ...prev, selectedNodeId: node.id }));
  }, []);

  const onAddNode = useCallback(() => {
    setState((prev) => {
      const root = prev.nodes.find((n) => n.id === "root-core");
      const anchor = root ?? prev.nodes[0];
      const position = anchor
        ? { x: anchor.position.x + 220, y: anchor.position.y + 220 }
        : { x: 100, y: 100 };
      const newNode = createDefaultHexagonNode("entity", "New Node", position);

      return {
        ...prev,
        nodes: [...prev.nodes, newNode],
        edges: prev.edges,
        selectedNodeId: newNode.id,
      };
    });
  }, []);

  const onExportImage = useCallback(() => {}, []);

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

  const handleClearCanvasLayout = useCallback(async () => {
    await clearLayout();
  }, [clearLayout]);

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
    clearCanvasLayout: handleClearCanvasLayout,
  };
}
