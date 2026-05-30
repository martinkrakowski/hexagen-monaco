import { END, START, StateGraph } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { GraphStateAnnotation } from "../state/graph-state";
import { routeAfterError } from "../edges/routing";
import { inputProcessorNode } from "../nodes/input-processor.node";
import { llmCallNode } from "../nodes/llm-call.node";
import { outputFormatterNode } from "../nodes/output-formatter.node";

/**
 * Linear example graph: input-processor → llm-call → output-formatter.
 * Errors short-circuit straight to output-formatter so the failure mode
 * goes through the same exit path as success — keeps the API contract
 * (always returns a string output + steps audit) consistent for callers.
 *
 *      START
 *        │
 *        ▼
 *  input-processor
 *        │
 *        ▼
 *      llm-call
 *      ╱      ╲
 *  error    continue
 *      ╲      ╱
 *   (human-review)        ← inserted only if LANGGRAPH_HITL_ENABLED=true
 *        │
 *        ▼
 *  output-formatter
 *        │
 *        ▼
 *       END
 *
 * The human-review node is dynamic-imported only when the env var is
 * set so projects that didn't install the HITL scaffolding (the file
 * isn't emitted unless `human_in_loop=true` at install) don't pay an
 * unresolved-import cost. If the env var is on but the file is missing,
 * we throw a clear "re-run the generator with human_in_loop=true"
 * message instead of bubbling up Node's raw ERR_MODULE_NOT_FOUND.
 */
export async function buildMainGraph(checkpointer: BaseCheckpointSaver) {
  const builder = new StateGraph(GraphStateAnnotation)
    .addNode("input-processor", inputProcessorNode)
    .addNode("llm-call", llmCallNode)
    .addNode("output-formatter", outputFormatterNode);

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
      .addEdge(START, "input-processor")
      .addEdge("input-processor", "llm-call")
      .addConditionalEdges("llm-call", routeAfterError, {
        continue: "human-review",
        error: "output-formatter",
      })
      .addEdge("human-review", "output-formatter")
      .addEdge("output-formatter", END);
    interruptBefore.push("human-review");
  } else {
    builder
      .addEdge(START, "input-processor")
      .addEdge("input-processor", "llm-call")
      .addConditionalEdges("llm-call", routeAfterError, {
        continue: "output-formatter",
        error: "output-formatter",
      })
      .addEdge("output-formatter", END);
  }

  return builder.compile({ checkpointer, interruptBefore });
}
