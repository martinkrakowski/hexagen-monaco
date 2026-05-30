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
 *  output-formatter
 *        │
 *        ▼
 *       END
 */
export function buildMainGraph(checkpointer: BaseCheckpointSaver) {
  const builder = new StateGraph(GraphStateAnnotation)
    .addNode("input-processor", inputProcessorNode)
    .addNode("llm-call", llmCallNode)
    .addNode("output-formatter", outputFormatterNode)
    .addEdge(START, "input-processor")
    .addEdge("input-processor", "llm-call")
    .addConditionalEdges("llm-call", routeAfterError, {
      continue: "output-formatter",
      error: "output-formatter",
    })
    .addEdge("output-formatter", END);

  return builder.compile({ checkpointer });
}
