export type ProjectionErrorType =
  | "unrealizable-projection"
  | "incompatible-affordance"
  | "unknown-node-kind"
  | "missing-variant"
  | "missing-icon"
  | "invalid-category";

export interface ProjectionError {
  readonly type: ProjectionErrorType;
  readonly message: string;
  readonly nodeId?: string;
  readonly details?: Record<string, unknown>;
}

export function createProjectionError(
  type: ProjectionErrorType,
  message: string,
  nodeId?: string,
  details?: Record<string, unknown>,
): ProjectionError {
  return { type, message, nodeId, details };
}
