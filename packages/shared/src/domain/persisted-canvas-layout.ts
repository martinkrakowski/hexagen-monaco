export interface NodePosition {
  readonly x: number;
  readonly y: number;
}

export type PersistedCanvasLayout = {
  readonly schemaVersion: 1;
  readonly sessionId: string;
  readonly updatedAt: number;
  readonly nodePositions: Record<string, NodePosition>;
};
