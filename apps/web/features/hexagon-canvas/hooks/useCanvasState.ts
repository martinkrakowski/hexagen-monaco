import { useState, useCallback, useEffect } from "react";
import type {
  HexagonNode,
  HexagonEdge,
  CanvasViewport,
} from "@hexagen/visualization";
import {
  RenderHexagonCanvasUseCase,
  createCanvasViewport,
  createDefaultHexagonNode,
} from "@hexagen/visualization";
import { nodeKindFromHexagonType } from "@hexagen/ui-projection-compiler";
import type { SolveGraphLayoutUseCase } from "@hexagen/layout-engine";
import {
  getArchitectureGraphProvider,
  getGenerateHexagonalMapUseCase,
  getMapNodeVisualUseCase,
  getSolveGraphLayoutUseCase,
} from "@/lib/wire";
import type { WizardData } from "@hexagen/shared";
import { useCanvasLayout } from "./useCanvasLayout";

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

function applyGraphLayout(
  nodes: HexagonNode[],
  edges: HexagonEdge[],
  useCase: SolveGraphLayoutUseCase,
): HexagonNode[] {
  const layoutNodes = nodes.map((n) => ({
    id: n.id,
    width: 180,
    height: 100,
  }));
  const layoutEdges = edges.map((e) => ({
    source: e.source,
    target: e.target,
  }));
  const { positions } = useCase.execute(layoutNodes, layoutEdges, "TB");
  const positionMap = new Map(positions.map((p) => [p.nodeId, p]));
  return nodes.map((node) => {
    const pos = positionMap.get(node.id);
    if (pos) {
      return { ...node, position: { x: pos.x, y: pos.y } };
    }
    return node;
  });
}

export function useCanvasState(
  projectId?: string,
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
      const generateMap = getGenerateHexagonalMapUseCase();
      const { nodes, edges } = generateMap.execute({ wizardData });
      const mapNodeVisualUseCase = getMapNodeVisualUseCase();
      const compiledNodes = nodes.map((node) => {
        const needsCompilation = [
          "entity",
          "use-case",
          "port",
          "adapter",
        ].includes(node.type ?? "");
        if (needsCompilation && mapNodeVisualUseCase) {
          const kind = nodeKindFromHexagonType(node.type, node.side);
          const projection = mapNodeVisualUseCase.execute({
            nodeId: node.id,
            kind,
            label: node.label,
            category: node.category,
          });
          return {
            ...node,
            category: projection.category,
            compilerCategory: projection.category,
            variant: projection.variant,
          };
        }
        return node;
      });
      const nodesWithPositions = applySavedPositions(compiledNodes);
      setState({
        nodes: nodesWithPositions,
        edges,
        viewport: createCanvasViewport(),
      });
      return;
    }

    if (!projectId) {
      setError(
        new Error(
          "No project ID provided. The graph must be derived from WizardData.",
        ),
      );
      return;
    }

    const provider = getArchitectureGraphProvider();
    const result = await provider.getArchitectureGraph(projectId);

    if (result.success === false) {
      setError(result.error);
      return;
    }

    const { nodes, edges } = result.data;
    const solveGraphLayoutUseCase = getSolveGraphLayoutUseCase();
    const laidOutNodes = applyGraphLayout(
      nodes,
      edges,
      solveGraphLayoutUseCase,
    );
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
