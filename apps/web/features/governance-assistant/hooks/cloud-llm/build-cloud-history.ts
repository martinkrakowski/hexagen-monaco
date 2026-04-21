import type { CloudChatMessage } from "../useCloudLlm";

/**
 * Builds the LLM-facing message array for a cloud chat call.
 *
 * Takes the chat state AS IT WAS before the new user message is
 * appended — the helper then appends the user message itself. This
 * replaces the original code's "setState((prev) => { read prev.messages
 * and return prev })" trick, which relied on React batching semantics
 * (and could double-push the current user message depending on whether
 * the prior setState had flushed).
 */
export function buildCloudMessageHistory(
  priorMessages: readonly CloudChatMessage[],
  userContent: string,
  systemPrompt?: string,
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const history: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [];

  if (systemPrompt) {
    history.push({ role: "system", content: systemPrompt });
  }

  for (const m of priorMessages) {
    if (m.role === "system") continue;
    history.push({ role: m.role, content: m.content });
  }

  history.push({ role: "user", content: userContent });
  return history;
}
