import type {
  CloudLLMProviderPort,
  CloudLLMCompletionRequest,
  CloudLLMCompletionResponse,
} from "../../domain/ports/cloud-llm-provider.port";
import { ok, err, type Result } from "@hexagen/shared";

export class OpenAICompatibleAdapter implements CloudLLMProviderPort {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly defaultModel: string,
  ) {}

  async complete(
    request: CloudLLMCompletionRequest,
  ): Promise<Result<CloudLLMCompletionResponse>> {
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
        signal: request.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        return err(new Error(`LLM API error: ${response.status} ${errorText}`));
      }

      const data = (await response.json()) as {
        id: string;
        model: string;
        usage?: {
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
        };
      };

      return ok({
        id: data.id,
        model: data.model,
        usage: data.usage
          ? {
              promptTokens: data.usage.prompt_tokens,
              completionTokens: data.usage.completion_tokens,
              totalTokens: data.usage.total_tokens,
            }
          : undefined,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return err(new Error("Request aborted"));
      }
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async *streamComplete(
    request: CloudLLMCompletionRequest,
  ): AsyncGenerator<Result<string>> {
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
        signal: request.signal,
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
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      yield err(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
