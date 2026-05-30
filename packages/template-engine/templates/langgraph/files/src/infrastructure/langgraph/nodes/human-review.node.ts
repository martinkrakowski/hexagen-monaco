import type { GraphState, GraphStateUpdate } from "../state/graph-state";

/**
 * Human-in-the-loop pause point. Wire this into your graph BEFORE the
 * node you want a human to approve, and compile with
 * `interruptBefore: ["human-review"]` so LangGraph pauses execution
 * when control reaches this node. The graph state is checkpointed at
 * the pause; the /api/agent/resume route reads the human's input from
 * the request and calls `graph.invoke({ humanInput }, { configurable:
 * { thread_id: threadId } })` to continue.
 *
 * This node intentionally does almost nothing — the value-add is the
 * pause + checkpoint LangGraph provides around it. When resumed, the
 * upstream invoke call carries `humanInput` into state via this node's
 * return so downstream nodes can read it from `state.input` (or wherever
 * you choose to merge it; this default re-assigns to `input` which is
 * usually the field downstream nodes already key off).
 *
 * Toggle the interrupt at runtime via `LANGGRAPH_HITL_ENABLED` if you
 * want a single graph definition that can run with or without the
 * pause depending on environment.
 */
export async function humanReviewNode(
  state: GraphState & { humanInput?: string },
): Promise<GraphStateUpdate> {
  if (typeof state.humanInput === "string" && state.humanInput.length > 0) {
    return {
      input: state.humanInput,
      steps: ["human-review:resumed"],
    };
  }
  // Resumed without input — treat as "approve unchanged" and continue.
  return { steps: ["human-review:approved-noop"] };
}
