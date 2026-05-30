import type { GraphState, GraphStateUpdate } from "../state/graph-state";

/**
 * Human-in-the-loop pause point. Wire this into your graph BEFORE the
 * node you want a human to approve, and compile with
 * `interruptBefore: ["human-review"]` so LangGraph pauses execution
 * when control reaches this node. The graph state is checkpointed at
 * the pause; the /api/agent/resume route calls
 * `adapter.resume(threadId, humanInput)`, which writes ONLY humanInput
 * as a partial state update — the original `input` prompt stays intact.
 *
 * Downstream nodes can read state.humanInput AND state.input as two
 * distinct values: the original user question vs the reviewer's
 * feedback. This node intentionally does not fold humanInput into
 * input — that would erase the original prompt and surprise any
 * subsequent node that re-reads it.
 *
 * Toggle the interrupt at runtime via `LANGGRAPH_HITL_ENABLED` if you
 * want a single graph definition that can run with or without the
 * pause depending on environment.
 */
export async function humanReviewNode(
  state: GraphState,
): Promise<GraphStateUpdate> {
  if (typeof state.humanInput === "string" && state.humanInput.length > 0) {
    // Tag the audit trail so downstream nodes and `/getState` consumers
    // can tell a resumed run from a first-pass one. The humanInput stays
    // on state for downstream nodes to read; clearing it would silently
    // drop the reviewer's signal between this node and the next.
    return { steps: ["human-review:resumed"] };
  }
  // Resumed without input — treat as "approve unchanged" and continue.
  return { steps: ["human-review:approved-noop"] };
}
