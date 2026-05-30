import { END, START, StateGraph } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { GraphStateAnnotation } from "../state/graph-state";
import { routeAfterError } from "../edges/routing";
import { plannerNode } from "../nodes/planner.node";
import { researcherNode } from "../nodes/researcher.node";
import { synthesiserNode } from "../nodes/synthesiser.node";

/**
 * Research-agent example graph: planner decomposes the question, the
 * researcher answers each sub-question in parallel, the synthesiser
 * stitches them into a final answer. Errors at any step propagate via
 * `errorMessage` and exit through the synthesiser (which knows how to
 * render the failure into the final output), keeping the success and
 * failure paths converged on one terminal node.
 *
 *      START
 *        │
 *        ▼
 *      planner
 *        │
 *        ▼
 *     researcher
 *      ╱      ╲
 *   error    continue
 *      ╲      ╱
 *    synthesiser
 *        │
 *        ▼
 *       END
 */
export function buildMainGraph(checkpointer: BaseCheckpointSaver) {
  const builder = new StateGraph(GraphStateAnnotation)
    .addNode("planner", plannerNode)
    .addNode("researcher", researcherNode)
    .addNode("synthesiser", synthesiserNode)
    .addEdge(START, "planner")
    .addEdge("planner", "researcher")
    .addConditionalEdges("researcher", routeAfterError, {
      continue: "synthesiser",
      error: "synthesiser",
    })
    .addEdge("synthesiser", END);

  return builder.compile({ checkpointer });
}
