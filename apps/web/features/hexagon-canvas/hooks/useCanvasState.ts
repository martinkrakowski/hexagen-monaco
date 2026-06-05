import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
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
import { canvasRedrawKey } from "../canvas-redraw-key";
import { computeAddOnOverlay } from "../addon-overlay";
import { addOnName } from "../addon-overlay-presentation";
import {
  annotateCompassNodes,
  buildStripChips,
  placeStripChips,
  overlayContextsFrom,
  type AddOnChipNode,
} from "../addon-overlay-nodes";
import { TEMPLATE_MANIFESTS } from "@/project-wizard/steps/add-ons-step/template-manifest.generated";

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
  clearCanvasLayout: () => Promise<void>;
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

  // Ref for wizardData so callbacks that read it don't need it in their dep arrays.
  const wizardDataRef = useRef(wizardData);
  wizardDataRef.current = wizardData;

  // Redraw the canvas only when the diagram-relevant slice changes — the
  // contexts/peer mappings (compass) + the SELECTED add-on id-set (the overlay
  // keys on ids). A per-add-on answer-value change (e.g. a queue name) or a
  // governance edit leaves this stable, so the expensive compass regeneration is
  // skipped — while wizardData itself stays fresh for other consumers (the
  // answer-only optimization belongs here, not in the shared useWizardForm).
  const wizardDataHash = useMemo(
    () =>
      wizardData ? generateManifestHash(canvasRedrawKey(wizardData)) : null,
    [wizardData],
  );

  // Zustand store for structural state — useShallow prevents re-render when
  // only action function identities change (actions are stable in Zustand, but
  // the destructured object from a bare useCanvasGraphStore() call creates a
  // new reference every render).
  const {
    nodes,
    edges,
    manifestHash,
    isLayoutCalculating,
    setGraph,
    updateNodePosition,
    setManifestHash,
    setLayoutCalculating,
  } = useCanvasGraphStore(
    useShallow((s) => ({
      nodes: s.nodes,
      edges: s.edges,
      manifestHash: s.manifestHash,
      isLayoutCalculating: s.isLayoutCalculating,
      setGraph: s.setGraph,
      updateNodePosition: s.updateNodePosition,
      setManifestHash: s.setManifestHash,
      setLayoutCalculating: s.setLayoutCalculating,
    })),
  );

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

        // The generator positions ALL root-level nodes explicitly using
        // LAYOUT_CONFIG offsets:
        // - The bounded-context hex
        // - Compass adapters on N/S (primary/secondary adapters)
        // - Compass ports on W/E (primary/secondary ports)
        // - Root-level entities and use-cases stacked south of the hex
        // We preserve these positions and let ELK influence ONLY the inner
        // layout (currently just the Domain / UseCases column labels inside
        // the hex). ELK's layered/partitioning algorithm conflates north/south
        // with west/east into horizontal lanes, which breaks compass semantics,
        // so applying it to the perimeter would misplace every compass node.
        // See docs/architectural-reviews/HEXAGONAL-LAYOUT-REMEDIATION-2026-04-29.md.
        return nodes.map((node) => {
          const nodeWithLayout = node as HexagonNode & {
            parentId?: string;
            side?: "north" | "south" | "east" | "west";
          };
          // Any root-level node (no parentId) is generator-positioned.
          const isRootLevel = !nodeWithLayout.parentId;
          // Domain / UseCases column labels live INSIDE the hex (parentId set
          // to the bounded-context id). They are laid out by the generator at
          // the bottom band of the hex (DOMAIN_NODE_X/Y, USECASES_NODE_X/Y).
          // ELK's box algorithm would otherwise repack them into arbitrary
          // positions inside the hex.
          const isInnerLabel = node.type === "inner";
          if (isRootLevel || isInnerLabel) {
            return node;
          }
          const position = positionMap.get(node.id);
          return position ? { ...node, position } : node;
        });
      } catch (err) {
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
   * Regenerate a fresh, compiled graph from wizardData.
   * Does NOT run ELK — caller decides whether to run layout or apply saved
   * positions. Returns null when wizardData has no bounded contexts.
   *
   * Uses wizardDataRef to avoid destabilizing dependents when wizardData
   * identity changes on every parent render (e.g. every keystroke in wizard).
   * The wizardData *content* change is handled by the useEffect that triggers
   * loadGraph.
   */
  const regenerateGraphFromWizard = useCallback((): {
    nodes: HexagonNode[];
    edges: HexagonEdge[];
    chips: AddOnChipNode[];
  } | null => {
    const wd = wizardDataRef.current;
    if (!wd?.boundedContexts?.length) {
      return null;
    }
    const generateMap = getGenerateHexagonalMapUseCase();
    const { nodes, edges } = generateMap.execute({ wizardData: wd });
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

    // Add-on overlay (web-only; @hexagen/visualization stays add-on-agnostic):
    // annotate declared compass adapters in place, and build strip chips for
    // platform-zone / shared-kernel add-ons (positioned post-layout).
    const overlayContexts = overlayContextsFrom(wd.boundedContexts ?? []);
    const overlay = computeAddOnOverlay(
      wd.addOnsAnswers ?? {},
      (id) => TEMPLATE_MANIFESTS[id],
      overlayContexts,
    );
    annotateCompassNodes(compiledNodes, overlay, overlayContexts);
    const chips = buildStripChips(overlay, addOnName);

    return { nodes: compiledNodes, edges, chips };
  }, []);

  /**
   * Load and process graph data
   */
  const loadGraph = useCallback(async () => {
    setError(null);

    if (!layoutLoaded) {
      return;
    }

    const wd = wizardDataRef.current;
    if (wd?.boundedContexts?.length) {
      const newHash = generateManifestHash(canvasRedrawKey(wd));

      // Early exit: content unchanged — skip regeneration, store writes,
      // and viewport reset. This prevents per-keystroke cascades when
      // wizardData identity churns but the serialized form is identical.
      if (manifestHash === newHash && manifestHash !== null) {
        return;
      }

      const regenerated = regenerateGraphFromWizard();
      if (!regenerated) return;
      const { nodes: compiledNodes, edges, chips } = regenerated;

      const manifestChanged = manifestHash !== null && manifestHash !== newHash;

      let finalNodes: HexagonNode[];
      if (manifestChanged || Object.keys(nodePositions).length === 0) {
        finalNodes = await calculateElkLayout(compiledNodes, edges);
      } else {
        finalNodes = applySavedPositions(compiledNodes);
      }

      // Position add-on strip chips AFTER layout, from the laid-out bounding box
      // (so they always clear the lowest context). Chips use a web-only node
      // type the store + React Flow render structurally.
      const placedChips = placeStripChips(finalNodes, chips);
      if (placedChips.length > 0) {
        finalNodes = [
          ...finalNodes,
          ...(placedChips as unknown as HexagonNode[]),
        ];
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
    manifestHash,
    nodePositions,
    applySavedPositions,
    calculateElkLayout,
    regenerateGraphFromWizard,
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
  }, [layoutLoaded, wizardDataHash, loadGraph]);

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

  /**
   * Add a new entity node. Reads current nodes/edges from the store at
   * invocation time to avoid depending on array identity in the dep list.
   */
  const onAddNode = useCallback(() => {
    const { nodes: currentNodes, edges: currentEdges } =
      useCanvasGraphStore.getState();
    const root = currentNodes.find((n) => n.id === "root-core");
    const anchor = root ?? currentNodes[0];
    const position = anchor
      ? { x: anchor.position.x + 220, y: anchor.position.y + 220 }
      : { x: 100, y: 100 };
    const newNode = createDefaultHexagonNode("entity", "New Node", position);

    setGraph([...currentNodes, newNode], currentEdges);
    setState((prev) => ({ ...prev, selectedNodeId: newNode.id }));
  }, [setGraph]);

  const onExportImage = useCallback(() => {}, []);

  /**
   * Update a node's label/type. Reads current nodes/edges from the store at
   * invocation time to avoid depending on array identity in the dep list.
   */
  const onUpdateNode = useCallback(
    (nodeId: string, updates: Pick<HexagonNode, "label" | "type">) => {
      const { nodes: currentNodes, edges: currentEdges } =
        useCanvasGraphStore.getState();
      const updatedNodes = currentNodes.map((n) =>
        n.id === nodeId ? { ...n, ...updates } : n,
      );
      setGraph(updatedNodes, currentEdges);
    },
    [setGraph],
  );

  const onCloseEditor = useCallback(() => {
    setState((prev) => ({ ...prev, selectedNodeId: undefined }));
  }, []);

  /**
   * Clear persisted layout + regenerate canonical graph from wizardData, then
   * run ELK. Used by the Clean-up button. This drops any user-dragged
   * positions and returns the canvas to its pristine generator-produced
   * layout with fresh ELK positioning for internal nodes.
   *
   * Falls back to recalculating the current store graph when wizardData is
   * unavailable (e.g., non-wizard flows that load a projectId).
   */
  const handleClearCanvasLayout = useCallback(async () => {
    await clearLayout();

    const regenerated = regenerateGraphFromWizard();
    if (regenerated) {
      const { nodes: freshNodes, edges: freshEdges } = regenerated;
      const laidOutNodes = await calculateElkLayout(freshNodes, freshEdges);
      setGraph(laidOutNodes, freshEdges);
      return;
    }

    const { nodes: currentNodes, edges: currentEdges } =
      useCanvasGraphStore.getState();
    const laidOutNodes = await calculateElkLayout(currentNodes, currentEdges);
    setGraph(laidOutNodes, currentEdges);
  }, [clearLayout, regenerateGraphFromWizard, calculateElkLayout, setGraph]);

  /**
   * Force recalculate layout on the current store graph (does NOT regenerate).
   * Kept for callers that want to re-run ELK without discarding in-progress
   * user edits. The Clean-up button uses handleClearCanvasLayout above.
   *
   * Reads nodes/edges from the store at invocation time to avoid depending
   * on array identity in the dep list.
   */
  const recalculateLayout = useCallback(async () => {
    const { nodes: currentNodes, edges: currentEdges } =
      useCanvasGraphStore.getState();
    const laidOutNodes = await calculateElkLayout(currentNodes, currentEdges);
    setGraph(laidOutNodes, currentEdges);
  }, [calculateElkLayout, setGraph]);

  if (error) {
    return { error };
  }

  return useMemo(
    () => ({
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
    }),
    [
      nodes,
      edges,
      state.viewport,
      state.selectedNodeId,
      isLayoutCalculating,
      onNodeDragStop,
      onNodeDoubleClick,
      onAddNode,
      onExportImage,
      onUpdateNode,
      onCloseEditor,
      handleClearCanvasLayout,
      recalculateLayout,
    ],
  );
}

// Made with Bob
