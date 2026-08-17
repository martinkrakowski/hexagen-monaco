import { create } from "zustand";
import { temporal } from "zundo";
import type {
  RenderableHexagonNode,
  RenderableHexagonEdge,
} from "@hexagen/visualization";

/**
 * Structural state for the canvas graph.
 * Separated from ephemeral UI state (selection, hover) for clean undo/redo.
 *
 * Typed on the *renderable* node/edge (HEX-030), not the domain ones: this
 * store feeds React Flow, so what it holds legitimately carries `extent`,
 * `style` and `variant`. Before the split those fields sat on the domain type
 * and every reader in this slice recovered them with a cast — `node as
 * HexagonNodeWithLayout`. Naming the right type here is what removed the casts.
 */
export interface CanvasGraphState {
  nodes: RenderableHexagonNode[];
  edges: RenderableHexagonEdge[];
  manifestHash: string | null;
  isLayoutCalculating: boolean;
}

/**
 * Actions for modifying the canvas graph state.
 */
export interface CanvasGraphActions {
  setNodes: (nodes: RenderableHexagonNode[]) => void;
  setEdges: (edges: RenderableHexagonEdge[]) => void;
  setGraph: (
    nodes: RenderableHexagonNode[],
    edges: RenderableHexagonEdge[],
  ) => void;
  updateNodePosition: (
    nodeId: string,
    position: { x: number; y: number },
  ) => void;
  updateNodePositions: (
    updates: Array<{ nodeId: string; position: { x: number; y: number } }>,
  ) => void;
  setManifestHash: (hash: string) => void;
  setLayoutCalculating: (calculating: boolean) => void;
  reset: () => void;
}

export type CanvasGraphStore = CanvasGraphState & CanvasGraphActions;

const initialState: CanvasGraphState = {
  nodes: [],
  edges: [],
  manifestHash: null,
  isLayoutCalculating: false,
};

/**
 * Generate a hash from manifest data to detect configuration changes.
 */
export function generateManifestHash(data: unknown): string {
  const str = JSON.stringify(data);
  // Simple hash for browser environment
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}

/**
 * Zustand store with temporal middleware for undo/redo.
 *
 * Key features:
 * - Tracks structural state (nodes, edges, manifestHash)
 * - Excludes ephemeral state (isLayoutCalculating) from history
 * - Only records snapshots on specific actions (not every pixel during drag)
 * - Provides undo/redo capabilities via temporal middleware
 */
export const useCanvasGraphStore = create<CanvasGraphStore>()(
  temporal(
    (set) => ({
      ...initialState,

      setNodes: (nodes) => set({ nodes }),

      setEdges: (edges) => set({ edges }),

      setGraph: (nodes, edges) => set({ nodes, edges }),

      updateNodePosition: (nodeId, position) =>
        set((state) => ({
          nodes: state.nodes.map((node) =>
            node.id === nodeId ? { ...node, position } : node,
          ),
        })),

      updateNodePositions: (updates) =>
        set((state) => {
          const updateMap = new Map(updates.map((u) => [u.nodeId, u.position]));
          return {
            nodes: state.nodes.map((node) => {
              const newPosition = updateMap.get(node.id);
              return newPosition ? { ...node, position: newPosition } : node;
            }),
          };
        }),

      setManifestHash: (hash) => set({ manifestHash: hash }),

      setLayoutCalculating: (calculating) =>
        set({ isLayoutCalculating: calculating }),

      reset: () => set(initialState),
    }),
    {
      // Temporal middleware options
      limit: 50, // Keep last 50 states in history
      equality: (pastState, currentState) => {
        // Only track changes to structural state, not ephemeral UI state
        return (
          pastState.nodes === currentState.nodes &&
          pastState.edges === currentState.edges &&
          pastState.manifestHash === currentState.manifestHash
        );
      },
    },
  ),
);

/**
 * Access temporal state for undo/redo operations.
 * Use: const { undo, redo, clear, pastStates, futureStates } = useCanvasGraphStore.temporal.getState()
 */
export const getTemporalState = () => useCanvasGraphStore.temporal.getState();

// Made with Bob
