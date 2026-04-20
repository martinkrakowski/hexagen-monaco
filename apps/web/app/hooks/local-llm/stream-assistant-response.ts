import {
  DEFAULT_MODEL_ID,
  DEFAULT_TUNING_CONFIG,
  type ChatMessage,
  type LLMMessage,
  type LocalLLMProviderPort,
} from "@hexagen/local-llm";

export interface StreamAssistantResponseOptions {
  adapter: LocalLLMProviderPort;
  /** Full message history (system prompt + prior turns + current user turn). */
  messages: LLMMessage[];
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

/**
 * Shared streaming loop used by both sendMessage and
 * sendGovernanceMessage. Calls adapter.streamComplete with the
 * default tuning config, walks the async iterator, and appends
 * successful tokens to the placeholder assistant message.
 *
 * Error result values (per-token stream errors) overwrite the
 * placeholder with an "Error: ..." message. Exceptions thrown by
 * the iterator itself bubble up to the caller to handle in a
 * try/finally. The caller owns the isStreaming flag and must clear
 * it regardless of outcome.
 */
export async function streamAssistantResponse({
  adapter,
  messages,
  assistantMessageId,
  abortController,
  setMessages,
}: StreamAssistantResponseOptions): Promise<void> {
  const loadedModel = adapter.getLoadedModel();
  const stream = adapter.streamComplete({
    modelId: loadedModel?.modelId ?? DEFAULT_MODEL_ID,
    messages,
    temperature: DEFAULT_TUNING_CONFIG.temperature,
    maxTokens: DEFAULT_TUNING_CONFIG.maxTokens,
    topP: DEFAULT_TUNING_CONFIG.topP,
    topK: DEFAULT_TUNING_CONFIG.topK,
    frequencyPenalty: DEFAULT_TUNING_CONFIG.frequencyPenalty,
    presencePenalty: DEFAULT_TUNING_CONFIG.presencePenalty,
    repetitionPenalty: DEFAULT_TUNING_CONFIG.repetitionPenalty,
    stream: true,
  });

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
