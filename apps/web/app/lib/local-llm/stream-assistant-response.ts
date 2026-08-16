import {
  DEFAULT_MODEL_ID,
  DEFAULT_TUNING_CONFIG,
  type ChatMessage,
  type DomainModelId,
  type SendStructuredRequestPort,
  type LLMRequest,
  FreeFormStringSchema,
} from "@hexagen/local-llm";

export interface StreamAssistantResponseOptions {
  adapter: SendStructuredRequestPort;
  modelId: DomainModelId;
  /** Full message history (system prompt + prior turns + current user turn). */
  messages: LLMRequest["messages"];
  /**
   * Id of the assistant placeholder message that will receive the
   * streamed tokens. Set by the caller before streaming begins.
   */
  assistantMessageId: string;
  /**
   * AbortController that callers can abort to interrupt the stream.
   * The helper checks `signal.aborted` between chunks.
   */
  abortController: AbortController;
  /**
   * Mutates the chat messages array. The helper appends each token
   * result via a functional update that finds the placeholder by id
   * and concatenates the token's `value` (or replaces with an error
   * string on stream-level error results).
   */
  setMessages: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void;
}

export async function streamAssistantResponse({
  adapter,
  modelId,
  messages,
  assistantMessageId,
  abortController,
  setMessages,
}: StreamAssistantResponseOptions): Promise<void> {
  const request: LLMRequest = {
    id: `stream-${Date.now()}`,
    modelId: modelId ?? DEFAULT_MODEL_ID,
    messages,
    schema: FreeFormStringSchema,
    temperature: DEFAULT_TUNING_CONFIG.temperature,
    maxTokens: DEFAULT_TUNING_CONFIG.maxTokens,
    topP: DEFAULT_TUNING_CONFIG.topP,
    stream: true,
  };

  const stream = adapter.streamStructuredRequest(request);

  for await (const result of stream) {
    if (abortController.signal.aborted) break;

    if (result.success) {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last.id !== assistantMessageId) return prev;
        return [
          ...prev.slice(0, -1),
          { ...last, content: last.content + result.value },
        ];
      });
    } else {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.id === assistantMessageId) {
          last.content = `Error: ${
            result.error instanceof Error
              ? result.error.message
              : String(result.error)
          }`;
        }
        return next;
      });
    }
  }
}
