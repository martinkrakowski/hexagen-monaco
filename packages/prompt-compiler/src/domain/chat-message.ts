/**
 * A single turn in the grounded-prompt conversation window.
 *
 * Distinct from @hexagen/local-llm ChatMessage (that VO also carries a
 * timestamp). local-llm depends_on prompt-compiler — do not invert the graph.
 */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}
