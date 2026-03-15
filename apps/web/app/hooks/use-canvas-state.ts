import { useState, useCallback, useEffect } from "react";
import dagre from "@dagrejs/dagre";
import type {
  HexagonNode,
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
}

interface UseCanvasStateResult extends GraphState {
  onNodeDragStop: (node: HexagonNode) => void;
  onNodeDoubleClick: (node: HexagonNode) => void;
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

  const onNodeDragStop = useCallback((_node: HexagonNode) => {
    void _node;
  }, []);

  const onNodeDoubleClick = useCallback((_node: HexagonNode) => {
    void _node;
  }, []);

  if (error) {
    return { error };
  }

  return {
    ...state,
    onNodeDragStop,
    onNodeDoubleClick,
  };
}
