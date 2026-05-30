import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { GraphState, GraphStateUpdate } from "../state/graph-state";

/**
 * Dispatches the prompt to the project's LLM adapter and stores both the
 * Human + AI messages on state. Reads through the `llmClient` instance
 * the llm-adapter template emits — swap the import below if you've
 * structured your DI differently.
 *
 * The error case sets `errorMessage` so `routeAfterError` can fork to
 * the output formatter (and then END) without each subsequent node
 * needing to defensively check.
 */
import { llmClient } from "../../llm";

export async function llmCallNode(
  state: GraphState,
): Promise<GraphStateUpdate> {
  if (state.errorMessage) {
    // Earlier node failed; pass through so the formatter can render it.
    return { steps: ["llm-call:skipped"] };
  }
  const response = await llmClient.call(state.input);
  if (!response.ok) {
    return {
      errorMessage: `llm-call failed: ${response.error.message}`,
      steps: [`llm-call:error:${response.error.kind}`],
    };
  }
  return {
    messages: [
      new HumanMessage(state.input),
      new AIMessage(response.value.content),
    ],
    output: response.value.content,
    steps: ["llm-call:ok"],
  };
}
