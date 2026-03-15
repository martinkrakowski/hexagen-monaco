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
  onUpdateNode: (nodeId: string, updates: Pick<HexagonNode, "label">) => void;
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
): HexagonNode {
  return {
    id: crypto.randomUUID(),
    label: "New Node",
    type,
    position: { x: 0, y: 0 },
  };
}

export function useCanvasState(
  projectId: string,
): UseCanvasStateResult | UseCanvasStateError {
  const [state, setState] = useState<GraphState>({
    nodes: [],
    edges: [],
    viewport: createCanvasViewport(),
  });
  const [error, setError] = useState<Error | null>(null);

  const loadGraph = useCallback(async () => {
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
  }, [projectId]);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

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
    (nodeId: string, updates: Pick<HexagonNode, "label">) => {
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
