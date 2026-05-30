import type { GraphState, GraphStateUpdate } from "../state/graph-state";
import { llmClient } from "../../llm";

const SYNTHESISER_SYSTEM_PROMPT = [
  "You are writing the final answer to a user question.",
  "You'll be given the original question and a set of sub-answers.",
  "Produce one coherent, properly-attributed response. Don't list the",
  "sub-questions verbatim — weave their conclusions into prose.",
].join("\n");

/**
 * Combines the researcher's tagged `<answers>` block with the original
 * user question into a single coherent response, written to `output`.
 * This is the terminal node of the research-agent graph.
 */
export async function synthesiserNode(
  state: GraphState,
): Promise<GraphStateUpdate> {
  if (state.errorMessage) {
    return {
      output: `Sorry, the request failed: ${state.errorMessage}`,
      steps: ["synthesiser:error-rendered"],
    };
  }
  // Find the <answers>…</answers> block produced by researcherNode.
  const found = [...state.messages]
    .reverse()
    .map((m) =>
      typeof m?.content === "string"
        ? m.content
        : JSON.stringify(m?.content ?? ""),
    )
    .find((c) => c.includes("<answers>"));
  const answersMatch = found?.match(/<answers>\s*([\s\S]*?)\s*<\/answers>/);
  const subAnswers = answersMatch?.[1]?.trim() ?? "";
  if (!subAnswers) {
    return {
      output: "(no research output to synthesise)",
      steps: ["synthesiser:empty"],
    };
  }
  const prompt = [
    `Original question: ${state.input}`,
    "",
    "Sub-answers:",
    subAnswers,
  ].join("\n");
  const response = await llmClient.call(prompt, {
    systemPrompt: SYNTHESISER_SYSTEM_PROMPT,
  });
  if (!response.ok) {
    return {
      errorMessage: `synthesiser failed: ${response.error.message}`,
      output: `Sorry, the request failed: ${response.error.message}`,
      steps: [`synthesiser:error:${response.error.kind}`],
    };
  }
  return {
    output: response.value.content,
    steps: ["synthesiser:ok"],
  };
}
