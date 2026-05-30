import type { GraphState, GraphStateUpdate } from "../state/graph-state";

/**
 * Terminal node — turns whatever the LLM produced (or whatever the
 * error path captured) into the final `output` string. Kept deliberately
 * thin: real formatting concerns (markdown rendering, length capping,
 * citations…) belong in dedicated nodes downstream, not here.
 */
export async function outputFormatterNode(
  state: GraphState,
): Promise<GraphStateUpdate> {
  if (state.errorMessage) {
    return {
      output: `Sorry, the request failed: ${state.errorMessage}`,
      steps: ["output-formatter:error-rendered"],
    };
  }
  if (state.output) {
    // LLM already produced a final string; pass it through unmodified
    // and mark the step so the audit trail is complete.
    return { steps: ["output-formatter:passthrough"] };
  }
  return {
    output: "(no output produced)",
    steps: ["output-formatter:empty"],
  };
}
