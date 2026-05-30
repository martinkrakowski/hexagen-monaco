import type { GraphState, GraphStateUpdate } from "../state/graph-state";

const MAX_INPUT_CHARS = 8_000;

/**
 * Validate + sanitise the user prompt before any LLM call. This is the
 * first node — if it sets `errorMessage`, downstream nodes can use the
 * shared error-routing helper to short-circuit straight to the output
 * formatter, so each example graph stays readable.
 */
export async function inputProcessorNode(
  state: GraphState,
): Promise<GraphStateUpdate> {
  const raw = state.input?.trim() ?? "";
  if (raw.length === 0) {
    return {
      errorMessage: "prompt cannot be empty",
      steps: ["input-processor:rejected:empty"],
    };
  }
  if (raw.length > MAX_INPUT_CHARS) {
    return {
      errorMessage: `prompt exceeds ${MAX_INPUT_CHARS} chars`,
      steps: ["input-processor:rejected:too-long"],
    };
  }
  return {
    input: raw,
    steps: ["input-processor:ok"],
  };
}
