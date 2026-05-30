import type { GraphState, GraphStateUpdate } from "../state/graph-state";
import { llmClient } from "../../llm";

const RESEARCHER_SYSTEM_PROMPT = [
  "You are answering one sub-question that's part of a larger research task.",
  "Be precise. Cite caveats. 3-4 sentences max.",
].join("\n");

/**
 * Iterates the sub-questions emitted by the planner and asks the LLM
 * each one. Calls are issued in parallel via `Promise.all`; for many
 * sub-questions you'd want a concurrency limiter or BullMQ fan-out,
 * but the example stays simple to keep the graph readable.
 *
 * The combined answers are appended as a single message tagged
 * `<answers>…</answers>` so the synthesiser can grep it out without
 * needing a new state field.
 */
export async function researcherNode(
  state: GraphState,
): Promise<GraphStateUpdate> {
  if (state.errorMessage) return { steps: ["researcher:skipped"] };
  // The planner node emitted its plan as the last AI message wrapped in
  // <plan> tags; extract the sub-questions back out.
  const lastMessage = state.messages[state.messages.length - 1];
  const rawContent =
    typeof lastMessage?.content === "string"
      ? lastMessage.content
      : JSON.stringify(lastMessage?.content ?? "");
  const planMatch = rawContent.match(/<plan>\s*([\s\S]*?)\s*<\/plan>/);
  const subQuestions = (planMatch?.[1] ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (subQuestions.length === 0) {
    return {
      errorMessage: "researcher: no sub-questions in plan",
      steps: ["researcher:error:no-plan"],
    };
  }
  const answers = await Promise.all(
    subQuestions.map(async (q) => {
      const response = await llmClient.call(q, {
        systemPrompt: RESEARCHER_SYSTEM_PROMPT,
      });
      if (!response.ok) {
        return `Q: ${q}\nA: (failed: ${response.error.message})`;
      }
      return `Q: ${q}\nA: ${response.value.content}`;
    }),
  );
  return {
    messages: [
      {
        type: "ai",
        content: `<answers>\n${answers.join("\n\n")}\n</answers>`,
      } as never,
    ],
    steps: [`researcher:ok:${answers.length}-answered`],
  };
}
