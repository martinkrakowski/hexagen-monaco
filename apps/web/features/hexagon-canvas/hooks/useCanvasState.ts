import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import type {
  RenderableHexagonNode,
  RenderableHexagonEdge,
  CanvasViewport,
} from "@hexagen/visualization";
import {
  RenderHexagonCanvasUseCase,
  createCanvasViewport,
} from "@hexagen/visualization";
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
import { useCanvasGraphMutations } from "./useCanvasGraphMutations";
import { useElkLayout } from "./useElkLayout";
import { canvasRedrawKey } from "../canvas-redraw-key";
import { addOnName } from "../addon-overlay-presentation";
import { placeStripChips } from "../addon-overlay-nodes";
import { compileWizardGraph } from "../compile-wizard-graph";
import { TEMPLATE_MANIFESTS } from "@/generated/template-manifest.generated";

interface GraphState {
  viewport: CanvasViewport;
  selectedNodeId?: string;
}

interface UseCanvasStateResult {
  nodes: RenderableHexagonNode[];
  edges: RenderableHexagonEdge[];
  viewport: CanvasViewport;
  selectedNodeId?: string;
  isLayoutCalculating: boolean;
  onNodeDragStop: (node: RenderableHexagonNode) => void;
  onNodeDoubleClick: (node: RenderableHexagonNode) => void;
  onAddNode: () => void;
  onExportImage: () => void;
  onUpdateNode: (
    nodeId: string,
    updates: Pick<RenderableHexagonNode, "label" | "type">,
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
    setManifestHash,
    setLayoutCalculating,
  } = useCanvasGraphStore(
    useShallow((s) => ({
      nodes: s.nodes,
      edges: s.edges,
      manifestHash: s.manifestHash,
      isLayoutCalculating: s.isLayoutCalculating,
      setGraph: s.setGraph,
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
    (nodes: RenderableHexagonNode[]): RenderableHexagonNode[] => {
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
      nodes: RenderableHexagonNode[],
      edges: RenderableHexagonEdge[],
    ): Promise<RenderableHexagonNode[]> => {
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
          // Any root-level node (no parentId) is generator-positioned.
          const isRootLevel = !node.parentId;
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
   * Bind the pure {@link compileWizardGraph} to this app's collaborators.
   *
   * The compile itself moved out of this hook (REA-004) — what is left here is
   * the wiring, resolved at call time from the container so the callback stays
   * referentially stable. It still reads `wizardDataRef` rather than
   * `wizardData` so it does not destabilize its dependents when the wizard's
   * object identity churns on every keystroke; the *content* change is what
   * the `loadGraph` effect keys on.
   */
  const regenerateGraphFromWizard = useCallback(
    () =>
      compileWizardGraph(wizardDataRef.current, {
        generateMap: getGenerateHexagonalMapUseCase(),
        mapNodeVisual: getMapNodeVisualUseCase(),
        templateManifestOf: (id) => TEMPLATE_MANIFESTS[id],
        addOnDisplayName: addOnName,
      }),
    [],
  );

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

      let finalNodes: RenderableHexagonNode[];
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
          ...(placedChips as unknown as RenderableHexagonNode[]),
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

  // Graph edits (REA-004): extracted, store-subscription-free, and stable for
  // the session. This hook keeps only the selection bookkeeping that belongs to
  // its own local state.
  const {
    onNodeDragStop: mutateNodePosition,
    onAddNode: addEntityNode,
    onUpdateNode,
  } = useCanvasGraphMutations({ persistNodePosition: legacyUpdatePosition });

  const onNodeDoubleClick = useCallback((node: RenderableHexagonNode) => {
    setState((prev) => ({ ...prev, selectedNodeId: node.id }));
  }, []);

  const onAddNode = useCallback(() => {
    const newNodeId = addEntityNode();
    setState((prev) => ({ ...prev, selectedNodeId: newNodeId }));
  }, [addEntityNode]);

  const onExportImage = useCallback(() => {}, []);

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

  // NOTE: this `useMemo` used to sit AFTER an `if (error) return { error }`
  // early return. Going from no-error to error therefore rendered one fewer
  // hook than the previous render, which React rejects outright
  // ("Rendered fewer hooks than expected") — so the very path that reports a
  // load failure crashed the tree instead of showing it. Every hook now runs
  // before any return.
  const result = useMemo(
    () => ({
      nodes,
      edges,
      viewport: state.viewport,
      selectedNodeId: state.selectedNodeId,
      isLayoutCalculating,
      onNodeDragStop: mutateNodePosition,
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
      mutateNodePosition,
      onNodeDoubleClick,
      onAddNode,
      onExportImage,
      onUpdateNode,
      onCloseEditor,
      handleClearCanvasLayout,
      recalculateLayout,
    ],
  );

  if (error) {
    return { error };
  }

  return result;
}

// Made with Bob
