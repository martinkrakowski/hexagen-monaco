import { END } from "@langchain/langgraph";
import type { GraphState } from "../state/graph-state";

/**
 * Routing helpers used by `addConditionalEdges()` in the graph builder.
 * Keep them small and pure — same state in, same routing decision out —
 * so they can be unit-tested without spinning up a graph.
 */

export type AfterNodeDecision = "continue" | "error" | typeof END;

/**
 * Generic "did the previous node error out?" decision. Most nodes can use
 * this directly; specialised nodes should write their own routing function
 * alongside the node file rather than overloading this with branches.
 */
export function routeAfterError(state: GraphState): AfterNodeDecision {
  if (state.errorMessage) return "error";
  return "continue";
}

/**
 * Used after the terminal node (typically output-formatter) to either
 * finish or short-circuit on error. Distinct from `routeAfterError` so the
 * graph reads top-to-bottom in one direction — error always exits, output
 * always ends.
 */
export function routeAfterOutput(state: GraphState): typeof END | "error" {
  if (state.errorMessage) return "error";
  return END;
}
