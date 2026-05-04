export interface GraphLayoutNode {
  readonly id: string;
  readonly width: number;
  readonly height: number;
}

export interface GraphLayoutEdge {
  readonly source: string;
  readonly target: string;
}

export interface GraphLayoutPosition {
  readonly nodeId: string;
  readonly x: number;
  readonly y: number;
}

export interface GraphLayoutResult {
  readonly positions: readonly GraphLayoutPosition[];
}

export interface GraphLayoutPort {
  layout(
    nodes: readonly GraphLayoutNode[],
    edges: readonly GraphLayoutEdge[],
    direction: "TB" | "LR",
  ): Promise<GraphLayoutResult>;
}
