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
 *  (human-review)        ← inserted only if LANGGRAPH_HITL_ENABLED=true
 *        │
 *        ▼
 *    synthesiser
 *        │
 *        ▼
 *       END
 *
 * The human-review node is dynamic-imported only when the env var is
 * set so projects that didn't install the HITL scaffolding (the file
 * isn't emitted unless `human_in_loop=true` at install) don't pay an
 * unresolved-import cost.
 */
export async function buildMainGraph(checkpointer: BaseCheckpointSaver) {
  const builder = new StateGraph(GraphStateAnnotation)
    .addNode("planner", plannerNode)
    .addNode("researcher", researcherNode)
    .addNode("synthesiser", synthesiserNode);

  const interruptBefore: string[] = [];

  if (process.env.LANGGRAPH_HITL_ENABLED === "true") {
    let humanReviewNode: typeof import("../nodes/human-review.node").humanReviewNode;
    try {
      ({ humanReviewNode } = await import("../nodes/human-review.node"));
    } catch (err) {
      throw new Error(
        "LANGGRAPH_HITL_ENABLED=true but ../nodes/human-review.node is not present. Re-run the template generator with human_in_loop=true (or unset LANGGRAPH_HITL_ENABLED to disable the interrupt).",
        { cause: err },
      );
    }
    builder
      .addNode("human-review", humanReviewNode)
      .addEdge(START, "planner")
      .addEdge("planner", "researcher")
      .addConditionalEdges("researcher", routeAfterError, {
        continue: "human-review",
        error: "synthesiser",
      })
      .addEdge("human-review", "synthesiser")
      .addEdge("synthesiser", END);
    interruptBefore.push("human-review");
  } else {
    builder
      .addEdge(START, "planner")
      .addEdge("planner", "researcher")
      .addConditionalEdges("researcher", routeAfterError, {
        continue: "synthesiser",
        error: "synthesiser",
      })
      .addEdge("synthesiser", END);
  }

  return builder.compile({ checkpointer, interruptBefore });
}
