export type Identifier = string;

export interface DomainASTLike {
  nodes: unknown[];
  edges: unknown[];
  invariants: {
    topology: unknown[];
    cardinality: unknown[];
  };
}

export interface LLMResponse {
  id: string;
  content: string;
  finishReason: "stop" | "length" | "content_filter" | "error";
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  metadata?: Record<string, unknown>;
}

export interface Patch {
  id: string;
  type:
    | "add_node"
    | "remove_node"
    | "add_edge"
    | "remove_edge"
    | "update_node"
    | "update_edge";
  targetId: string;
  payload: Record<string, unknown>;
}

export interface ReconciliationResult {
  success: boolean;
  patches: Patch[];
  errors: string[];
  summary: string;
}

export function createPatch(
  type: Patch["type"],
  targetId: string,
  payload: Record<string, unknown>,
): Patch {
  return {
    id: `patch-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    type,
    targetId,
    payload,
  };
}

export function createReconciliationResult(
  success: boolean,
  patches: Patch[] = [],
  errors: string[] = [],
  summary: string = "",
): ReconciliationResult {
  return {
    success,
    patches,
    errors,
    summary:
      summary ||
      (success ? "Reconciliation completed" : "Reconciliation failed"),
  };
}
