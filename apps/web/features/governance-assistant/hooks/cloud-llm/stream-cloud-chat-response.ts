import type { Dispatch, SetStateAction } from "react";

import type { CloudLLMState } from "../useCloudLlm";

export interface StreamCloudChatResponseOptions {
  response: Response;
  assistantId: string;
  setState: Dispatch<SetStateAction<CloudLLMState>>;
}

interface ParsedChunk {
  type: string;
  content?: string;
  message?: string;
}

/**
 * Parses the SSE-style response from /api/llm/chat and streams tokens
 * into the assistant placeholder message identified by `assistantId`.
 *
 * The route emits three event types:
 *   - chunk { content: string }   — append to placeholder
 *   - error { message: string }   — overwrite placeholder with error text
 *   - done                        — terminate stream, return to idle
 *
 * Callers handle network-level exceptions (AbortError vs everything
 * else) and flags cleanup (isStreamingRef, abortControllerRef) in
 * their try/finally. This helper only handles the body stream.
 */
export async function streamCloudChatResponse({
  response,
  assistantId,
  setState,
}: StreamCloudChatResponseOptions): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) {
    setState((prev) => ({
      ...prev,
      status: "error",
      errorMessage: "No response body",
    }));
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let streamDone = false;

  while (!streamDone) {
    const { done, value } = await reader.read();
    if (done) {
      streamDone = true;
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;

      const data = trimmed.slice(6);
      let parsed: ParsedChunk;
      try {
        parsed = JSON.parse(data) as ParsedChunk;
      } catch {
        // Malformed SSE frame — skip silently and continue.
        continue;
      }

      if (parsed.type === "chunk" && parsed.content) {
        const chunkContent = parsed.content;
        setState((prev) => ({
          ...prev,
          messages: prev.messages.map((m) =>
            m.id === assistantId
              ? { ...m, content: m.content + chunkContent }
              : m,
          ),
        }));
      } else if (parsed.type === "error") {
        const errorMessage = parsed.message ?? "Unknown error";
        setState((prev) => ({
          ...prev,
          status: "error",
          errorMessage,
          messages: prev.messages.map((m) =>
            m.id === assistantId
              ? { ...m, content: `Error: ${errorMessage}` }
              : m,
          ),
        }));
        return;
      } else if (parsed.type === "done") {
        setState((prev) => ({ ...prev, status: "idle" }));
        return;
      }
    }
  }

  // Stream ended without an explicit "done" event — treat as success.
  setState((prev) => ({ ...prev, status: "idle" }));
}
