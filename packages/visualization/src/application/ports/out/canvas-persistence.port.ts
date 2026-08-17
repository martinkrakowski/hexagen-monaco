import type { HexagonNode, HexagonEdge } from "../../../domain/index.js";

export interface CanvasViewportState {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasPersistenceState {
  nodes: HexagonNode[];
  edges: HexagonEdge[];
  viewport: CanvasViewportState;
  manifestHash: string | null;
  nodePositions: Record<string, { x: number; y: number }>;
}

export interface CanvasPersistencePort {
  saveCanvasState(state: CanvasPersistenceState): Promise<void>;
  loadCanvasState(): Promise<CanvasPersistenceState | null>;
  clearCanvasState(): Promise<void>;
  saveNodePosition(
    nodeId: string,
    position: { x: number; y: number },
  ): Promise<void>;
  getNodePosition(nodeId: string): Promise<{ x: number; y: number } | null>;
  clearNodePosition(nodeId: string): Promise<void>;
  saveManifestHash(hash: string): Promise<void>;
  getManifestHash(): Promise<string | null>;
}
