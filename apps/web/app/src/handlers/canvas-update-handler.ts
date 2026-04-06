import type { Result } from "@hexagen/shared";

export type CanvasMutationType =
  | "ADD_NODE"
  | "REMOVE_NODE"
  | "UPDATE_NODE"
  | "ADD_EDGE"
  | "REMOVE_EDGE"
  | "UPDATE_LAYOUT"
  | "SET_VIEWPORT";

export interface CanvasMutationIntent {
  type: CanvasMutationType;
  payload: {
    nodeId?: string;
    edgeId?: string;
    nodeData?: Record<string, unknown>;
    viewport?: { x: number; y: number; zoom: number };
    layoutOptions?: Record<string, unknown>;
  };
}

export interface CanvasMutationResult {
  applied: boolean;
  description: string;
  affectedNodes: string[];
  revertAction?: CanvasMutationIntent;
}

export type CanvasUpdateHandler = (
  intent: CanvasMutationIntent,
) => Promise<Result<CanvasMutationResult>>;

export function createCanvasUpdateHandler(
  applyMutation: (
    intent: CanvasMutationIntent,
  ) => Promise<Result<CanvasMutationResult>>,
): CanvasUpdateHandler {
  return async (
    intent: CanvasMutationIntent,
  ): Promise<Result<CanvasMutationResult>> => {
    return applyMutation(intent);
  };
}

export function describeCanvasMutation(intent: CanvasMutationIntent): string {
  switch (intent.type) {
    case "ADD_NODE":
      return `Add node "${intent.payload.nodeId}" to canvas`;
    case "REMOVE_NODE":
      return `Remove node "${intent.payload.nodeId}" from canvas`;
    case "UPDATE_NODE":
      return `Update node "${intent.payload.nodeId}"`;
    case "ADD_EDGE":
      return `Add edge "${intent.payload.edgeId}" between nodes`;
    case "REMOVE_EDGE":
      return `Remove edge "${intent.payload.edgeId}"`;
    case "UPDATE_LAYOUT":
      return `Recalculate canvas layout`;
    case "SET_VIEWPORT":
      return `Pan/zoom canvas viewport`;
    default:
      return `Apply ${intent.type} canvas mutation`;
  }
}
