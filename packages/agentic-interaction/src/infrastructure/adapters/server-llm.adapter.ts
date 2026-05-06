import type {
  LLMProviderPort,
  LLMCompletionRequest,
  LLMCompletionResponse,
} from "../../domain/ports/llm-provider.port";
import { ok, err } from "@hexagen/shared";

export class ServerLLMAdapter implements LLMProviderPort {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = "https://api.openai.com/v1",
    private readonly defaultModel: string = "gpt-4o-mini",
  ) {}

  /**
   * Check if an API key is configured.
   * Used for synchronous client-side gating before async operations.
   * @returns true if apiKey is non-empty; false otherwise
   */
  hasAccessKey(): boolean {
    return !!this.apiKey && this.apiKey.trim().length > 0;
  }

  async complete(
    request: LLMCompletionRequest,
  ): Promise<import("@hexagen/shared").Result<LLMCompletionResponse>> {
    const model = request.model || this.defaultModel;

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: request.messages,
          temperature: request.temperature ?? 0.7,
          max_tokens: request.maxTokens ?? 2048,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return err(new Error(`LLM API error: ${response.status} ${errorText}`));
      }

      const data = (await response.json()) as LLMCompletionResponse;
      return ok(data);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async *streamComplete(
    request: LLMCompletionRequest,
  ): AsyncGenerator<import("@hexagen/shared").Result<string>> {
    const model = request.model || this.defaultModel;

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: request.messages,
          temperature: request.temperature ?? 0.7,
          max_tokens: request.maxTokens ?? 2048,
          stream: true,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        yield err(new Error(`LLM API error: ${response.status} ${errorText}`));
        return;
      }

      if (!response.body) {
        yield err(new Error("No response body"));
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              yield ok(content);
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    } catch (error) {
      yield err(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
