/**
 * Application-facing contract for an agent graph. Callers depend on this
 * port; the LangGraph SDK version, graph topology, and node count are
 * infrastructure concerns hidden behind `langgraph.adapter.ts`. Swapping
 * to a different orchestration framework later only requires a new
 * adapter — no app-code change.
 */
export interface AgentGraphPort {
  invoke(
    input: GraphInput,
    config?: GraphConfig,
  ): Promise<GraphInvokeResult>;
  /**
   * Continue a graph paused at a human-review interrupt. Distinct from
   * invoke() because resume passes ONLY the reviewer's input as a partial
   * state update — the original prompt and the rest of the checkpointed
   * state are restored by LangGraph from the matching thread_id. Mixing
   * this into invoke() would mean overwriting `state.input` with the
   * reviewer's text and losing the original prompt.
   */
  resume?(
    threadId: string,
    humanInput: string,
    config?: GraphConfig,
  ): Promise<GraphInvokeResult>;
  stream?(
    input: GraphInput,
    config?: GraphConfig,
  ): AsyncIterable<GraphEvent>;
  getState(threadId: string): Promise<GraphStateSnapshot | null>;
}

export interface GraphInput {
  prompt: string;
  /** Reuse this to continue a paused graph (HITL) or to keep a multi-turn thread alive. */
  threadId?: string;
}

export interface GraphOutput {
  result: string;
  steps: string[];
  threadId: string;
}

export interface GraphConfig {
  maxSteps?: number;
}

export interface GraphEvent {
  type: "token" | "node_start" | "node_end" | "done" | "error";
  data: unknown;
}

/**
 * Lightweight Result discriminant. Kept inline so the port doesn't pull in
 * the wider Result helper from another template — if you already have one,
 * adapt this to use it.
 */
export type GraphInvokeResult =
  | { ok: true; value: GraphOutput }
  | { ok: false; error: GraphError };

export interface GraphError {
  kind: "timeout" | "node-failed" | "invalid-input" | "unknown";
  message: string;
  cause?: unknown;
}

/**
 * The shape returned by getState() — keep this orchestrator-agnostic.
 * Concrete fields are graph-specific (defined in graph-state.ts) but the
 * port surface only promises *something* identifiable plus a thread id.
 */
export interface GraphStateSnapshot {
  threadId: string;
  values: Record<string, unknown>;
  next: ReadonlyArray<string>;
}
