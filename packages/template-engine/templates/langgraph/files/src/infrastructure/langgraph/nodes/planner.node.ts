import { AIMessage } from "@langchain/core/messages";
import type { GraphState, GraphStateUpdate } from "../state/graph-state";
import { llmClient } from "../../llm";

/**
 * Breaks the user prompt into a short list of sub-questions the
 * researcher node will tackle in parallel. The plan itself is stored
 * on state via the `messages` channel so downstream nodes can read it
 * without us widening the GraphState schema for one example graph.
 *
 * The "plan" is intentionally a newline-separated list rather than a
 * structured array — keeps the demo template free of a Zod dependency
 * just for parsing.
 */
const PLANNER_SYSTEM_PROMPT = [
  "You are a research planner.",
  "Given a user question, output 3-5 concise sub-questions that, if",
  "answered, would let you write a thorough response.",
  "Output one sub-question per line. No numbering. No commentary.",
].join("\n");

export async function plannerNode(
  state: GraphState,
): Promise<GraphStateUpdate> {
  if (state.errorMessage) return { steps: ["planner:skipped"] };
  const response = await llmClient.call(state.input, {
    systemPrompt: PLANNER_SYSTEM_PROMPT,
  });
  if (!response.ok) {
    return {
      errorMessage: `planner failed: ${response.error.message}`,
      steps: [`planner:error:${response.error.kind}`],
    };
  }
  const subQuestions = response.value.content
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  // The downstream researcher node reads the sub-questions back out via
  // the last AI message — we tag it so the synthesiser can identify it.
  // Construct a real AIMessage instance (rather than a plain { type, content }
  // object cast through `as never`) so the messages array stays homogeneous
  // and downstream `instanceof BaseMessage` checks succeed.
  const planMessage = new AIMessage(
    `<plan>\n${subQuestions.join("\n")}\n</plan>`,
  );
  return {
    messages: response.value.content ? [planMessage] : [],
    steps: [`planner:ok:${subQuestions.length}-questions`],
  };
}
