import type {
  LLMProviderPort,
  LLMCompletionRequest,
  LLMCompletionResponse,
} from "../../domain/ports/llm-provider.port";
import { ok, err } from "@hexagen/shared";
import type { Attributes } from "@opentelemetry/api";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { LLM_SPAN_KIND, withLlmSpan } from "../telemetry/llm-span";

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

  private systemLabel(): string {
    return this.baseUrl.replace(/^https?:\/\//, "").split("/")[0];
  }

  private llmAttrs(operation: string, model: string): Attributes {
    const system = this.systemLabel();
    return {
      // Every span built from these attributes is an LLM span — including
      // the manually-managed streaming span, which has no helper to add it.
      "openinference.span.kind": LLM_SPAN_KIND,
      "llm.provider": system,
      "llm.system": system,
      "llm.model_name": model,
      "gen_ai.system": system,
      "gen_ai.request.model": model,
      "gen_ai.operation.name": operation,
    };
  }

  async complete(
    request: LLMCompletionRequest,
  ): Promise<import("@hexagen/shared").Result<LLMCompletionResponse>> {
    const model = request.model || this.defaultModel;

    return withLlmSpan(
      "llm.chat",
      this.llmAttrs("chat", model),
      async () => {
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
            return err(
              new Error(`LLM API error: ${response.status} ${errorText}`),
            );
          }

          const data = (await response.json()) as LLMCompletionResponse;
          return ok(data);
        } catch (error) {
          return err(error instanceof Error ? error : new Error(String(error)));
        }
      },
      // A provider failure returned as an error Result must mark the span
      // ERROR, not OK.
      (result) =>
        result.success
          ? undefined
          : result.error instanceof Error
            ? result.error
            : { name: "Error" },
    );
  }

  async *streamComplete(
    request: LLMCompletionRequest,
  ): AsyncGenerator<import("@hexagen/shared").Result<string>> {
    const model = request.model || this.defaultModel;
    const span = trace.getTracer("hexagen").startSpan("llm.chat.stream", {
      attributes: this.llmAttrs("chat.stream", model),
    });

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
        const error = new Error(
          `LLM API error: ${response.status} ${errorText}`,
        );
        // The failure is returned as a value, not thrown — mark the span
        // ERROR here, with the error's class name only.
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error.name,
        });
        yield err(error);
        return;
      }

      if (!response.body) {
        const error = new Error("No response body");
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error.name,
        });
        yield err(error);
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

      span.setStatus({ code: SpanStatusCode.OK });
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.name : "Error",
      });
      yield err(error instanceof Error ? error : new Error(String(error)));
    } finally {
      span.end();
    }
  }
}
