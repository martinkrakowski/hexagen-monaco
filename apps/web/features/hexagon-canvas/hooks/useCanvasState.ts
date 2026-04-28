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
import {
  getArchitectureGraphProvider,
  getGenerateHexagonalMapUseCase,
  getMapNodeVisualUseCase,
} from "@/lib/wire";
import type { WizardData } from "@hexagen/project-configuration";
import { useCanvasLayout } from "./useCanvasLayout";
import {
  useCanvasGraphStore,
  generateManifestHash,
} from "../stores/useCanvasGraphStore";
import { useElkLayout } from "./useElkLayout";

interface GraphState {
  viewport: CanvasViewport;
  selectedNodeId?: string;
}

interface UseCanvasStateResult {
  nodes: HexagonNode[];
  edges: HexagonEdge[];
  viewport: CanvasViewport;
  selectedNodeId?: string;
  isLayoutCalculating: boolean;
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
  recalculateLayout: () => Promise<void>;
}

interface UseCanvasStateError {
  error: Error;
}

export function useCanvasState(
  projectId?: string,
  wizardData?: WizardData,
): UseCanvasStateResult | UseCanvasStateError {
  const [state, setState] = useState<GraphState>({
    viewport: createCanvasViewport(),
  });
  const [error, setError] = useState<Error | null>(null);

  // Zustand store for structural state
  const {
    nodes,
    edges,
    manifestHash,
    isLayoutCalculating,
    setGraph,
    updateNodePosition,
    setManifestHash,
    setLayoutCalculating,
  } = useCanvasGraphStore();

  // Legacy persistence (will be replaced in Phase 3)
  const {
    nodePositions,
    isLoaded: layoutLoaded,
    updateNodePosition: legacyUpdatePosition,
    clearLayout,
  } = useCanvasLayout();

  // ELK layout worker
  const { calculateLayout } = useElkLayout();

  /**
   * Apply saved positions from legacy persistence
   */
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

  /**
   * Calculate layout using ELK worker
   */
  const calculateElkLayout = useCallback(
    async (
      nodes: HexagonNode[],
      edges: HexagonEdge[],
    ): Promise<HexagonNode[]> => {
      try {
        setLayoutCalculating(true);
        const result = await calculateLayout(nodes, edges, "RIGHT");

        // Apply calculated positions
        const positionMap = new Map(
          result.positions.map((p) => [p.nodeId, { x: p.x, y: p.y }]),
        );

        return nodes.map((node) => {
          const position = positionMap.get(node.id);
          return position ? { ...node, position } : node;
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("ELK layout calculation failed:", err);
        // Fallback to original positions
        return nodes;
      } finally {
        setLayoutCalculating(false);
      }
    },
    [calculateLayout, setLayoutCalculating],
  );

  /**
   * Load and process graph data
   */
  const loadGraph = useCallback(async () => {
    setError(null);

    if (!layoutLoaded) {
      return;
    }

    if (wizardData?.boundedContexts?.length) {
      const generateMap = getGenerateHexagonalMapUseCase();
      const { nodes, edges } = generateMap.execute({ wizardData });
      const mapNodeVisualUseCase = getMapNodeVisualUseCase();

      // Compile visual projections
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

      // Check if manifest changed
      const newHash = generateManifestHash(wizardData);
      const manifestChanged = manifestHash !== null && manifestHash !== newHash;

      // Apply saved positions or calculate new layout
      let finalNodes: HexagonNode[];
      if (manifestChanged || Object.keys(nodePositions).length === 0) {
        // Manifest changed or no saved positions - calculate layout
        finalNodes = await calculateElkLayout(compiledNodes, edges);
      } else {
        // Use saved positions
        finalNodes = applySavedPositions(compiledNodes);
      }

      setManifestHash(newHash);
      setGraph(finalNodes, edges);
      setState({
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

    const { nodes: rawNodes, edges: rawEdges } = result.data;

    // Calculate layout with ELK
    const laidOutNodes = await calculateElkLayout(rawNodes, rawEdges);
    const nodesWithPositions = applySavedPositions(laidOutNodes);

    const useCase = new RenderHexagonCanvasUseCase();
    const renderResult = await useCase.render({
      canvasId: projectId,
      nodes: nodesWithPositions,
      edges: rawEdges,
    });

    setGraph(nodesWithPositions, rawEdges);
    setState({
      viewport: renderResult.viewport,
    });
  }, [
    projectId,
    layoutLoaded,
    wizardData,
    manifestHash,
    nodePositions,
    applySavedPositions,
    calculateElkLayout,
    setManifestHash,
    setGraph,
  ]);

  useEffect(() => {
    setError(null);
  }, [wizardData?.boundedContexts?.length]);

  useEffect(() => {
    if (layoutLoaded) {
      loadGraph();
    }
  }, [layoutLoaded, wizardData, loadGraph]);

  /**
   * Handle node drag stop - update both stores
   */
  const onNodeDragStop = useCallback(
    (node: HexagonNode) => {
      // Update legacy persistence
      legacyUpdatePosition(node.id, node.position);

      // Update Zustand store (will be recorded in history)
      updateNodePosition(node.id, node.position);
    },
    [legacyUpdatePosition, updateNodePosition],
  );

  const onNodeDoubleClick = useCallback((node: HexagonNode) => {
    setState((prev) => ({ ...prev, selectedNodeId: node.id }));
  }, []);

  const onAddNode = useCallback(() => {
    const root = nodes.find((n) => n.id === "root-core");
    const anchor = root ?? nodes[0];
    const position = anchor
      ? { x: anchor.position.x + 220, y: anchor.position.y + 220 }
      : { x: 100, y: 100 };
    const newNode = createDefaultHexagonNode("entity", "New Node", position);

    setGraph([...nodes, newNode], edges);
    setState((prev) => ({ ...prev, selectedNodeId: newNode.id }));
  }, [nodes, edges, setGraph]);

  const onExportImage = useCallback(() => {}, []);

  const onUpdateNode = useCallback(
    (nodeId: string, updates: Pick<HexagonNode, "label" | "type">) => {
      const updatedNodes = nodes.map((n) =>
        n.id === nodeId ? { ...n, ...updates } : n,
      );
      setGraph(updatedNodes, edges);
    },
    [nodes, edges, setGraph],
  );

  const onCloseEditor = useCallback(() => {
    setState((prev) => ({ ...prev, selectedNodeId: undefined }));
  }, []);

  /**
   * Clear layout and recalculate
   */
  const handleClearCanvasLayout = useCallback(async () => {
    await clearLayout();
    // Recalculate layout
    const laidOutNodes = await calculateElkLayout(nodes, edges);
    setGraph(laidOutNodes, edges);
  }, [clearLayout, nodes, edges, calculateElkLayout, setGraph]);

  /**
   * Force recalculate layout (for "Clean-up" button)
   */
  const recalculateLayout = useCallback(async () => {
    const laidOutNodes = await calculateElkLayout(nodes, edges);
    setGraph(laidOutNodes, edges);
  }, [nodes, edges, calculateElkLayout, setGraph]);

  if (error) {
    return { error };
  }

  return {
    nodes,
    edges,
    viewport: state.viewport,
    selectedNodeId: state.selectedNodeId,
    isLayoutCalculating,
    onNodeDragStop,
    onNodeDoubleClick,
    onAddNode,
    onExportImage,
    onUpdateNode,
    onCloseEditor,
    clearCanvasLayout: handleClearCanvasLayout,
    recalculateLayout,
  };
}

// Made with Bob
