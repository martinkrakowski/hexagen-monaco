import type { Result } from "@hexagen/shared";
import type {
  SendStructuredRequestPort,
  LLMRequest,
  LLMResponse,
} from "@hexagen/local-llm";
import { createLLMResponse } from "@hexagen/local-llm";
import type { DomainModelId } from "@hexagen/local-llm";
import type {
  ProviderFallbackChain,
  ResolvedProvider,
} from "../../domain/provider-config.js";
import { resolveFallbackChain } from "../../domain/provider-config.js";

export interface CloudLLMPipelineAdapterConfig {
  fallbackChain: ProviderFallbackChain;
  fetchFn?: typeof fetch;
}

interface ChatCompletionChoice {
  message: { role: string; content: string };
  finish_reason: string;
}

interface ChatCompletionResponse {
  id: string;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

export class CloudLLMPipelineAdapter implements SendStructuredRequestPort {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly config: CloudLLMPipelineAdapterConfig) {
    this.fetchFn = config.fetchFn ?? globalThis.fetch;
  }

  async sendRequest(request: LLMRequest): Promise<Result<LLMResponse>> {
    const providers = resolveFallbackChain(this.config.fallbackChain);
    if (providers.length === 0) {
      return {
        success: false,
        error: new Error(
          "No cloud LLM API keys configured. Set environment variables for at least one provider.",
        ),
      };
    }

    let lastError: Error | null = null;

    for (const provider of providers) {
      try {
        const response = await this.callProvider(provider, request);
        if (response) return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        continue;
      }
    }

    return {
      success: false,
      error: lastError ?? new Error("All cloud LLM providers failed"),
    };
  }

  async *streamStructuredRequest(
    request: LLMRequest,
  ): AsyncGenerator<Result<string>> {
    const providers = resolveFallbackChain(this.config.fallbackChain);
    if (providers.length === 0) {
      yield {
        success: false,
        error: new Error(
          "No cloud LLM API keys configured. Set environment variables for at least one provider.",
        ),
      };
      return;
    }

    let lastError: Error | null = null;

    for (const provider of providers) {
      try {
        for await (const result of this.streamProvider(provider, request)) {
          yield result;
          if (!result.success) {
            const err: Error =
              result.error instanceof Error
                ? result.error
                : new Error(String(result.error ?? "Unknown error"));
            lastError = err;
            const status = this.getErrorStatus(err);
            if (!isRetryable(status ?? 0)) {
              return;
            }
            break;
          }
          return;
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          yield {
            success: false,
            error: error instanceof Error ? error : new Error(String(error)),
          };
          return;
        }
        lastError = error instanceof Error ? error : new Error(String(error));
        continue;
      }
    }

    if (lastError) {
      yield { success: false, error: lastError };
    }
  }

  private getErrorStatus(error: Error): number | null {
    const match = error.message.match(/(\d{3})/);
    if (match) {
      const status = parseInt(match[1], 10);
      if (status >= 100 && status < 600) return status;
    }
    return null;
  }

  private async *streamProvider(
    provider: ResolvedProvider,
    request: LLMRequest,
  ): AsyncGenerator<Result<string>> {
    const messages = request.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const schemaJson = request.schema
      ? (request.schema as { _def: unknown })._def
        ? JSON.stringify(
            (
              request.schema as unknown as { toJsonSchema: () => unknown }
            ).toJsonSchema?.() ?? {},
          )
        : undefined
      : undefined;

    const body: Record<string, unknown> = {
      model: provider.model,
      messages,
      temperature: request.temperature ?? provider.temperature ?? 0.4,
      max_tokens: request.maxTokens ?? provider.maxTokens ?? 4096,
      stream: true,
    };
    if (schemaJson) {
      body.response_format = {
        type: "json_schema",
        json_schema: { name: "structured_output", schema: schemaJson },
      };
    }

    try {
      const abortController = new AbortController();
      const timeout = setTimeout(
        () => abortController.abort(),
        provider.timeoutMs ?? 60000,
      );

      const httpResponse = await this.fetchFn(
        `${provider.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${provider.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: abortController.signal,
        },
      );

      clearTimeout(timeout);

      if (!httpResponse.ok) {
        const errorText = await httpResponse.text();
        const error = new Error(
          `LLM API error: ${httpResponse.status} ${errorText}`,
        );
        yield { success: false, error };
        return;
      }

      if (!httpResponse.body) {
        yield { success: false, error: new Error("No response body") };
        return;
      }

      const reader = httpResponse.body.getReader();
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
              yield { success: true, value: content };
            }
          } catch {
            // Skip invalid JSON chunks
          }
        }
      }
    } catch (error) {
      yield {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  private async callProvider(
    provider: ResolvedProvider,
    request: LLMRequest,
  ): Promise<Result<LLMResponse> | null> {
    const messages = request.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const schemaJson = request.schema
      ? (request.schema as { _def: unknown })._def
        ? JSON.stringify(
            (
              request.schema as unknown as { toJsonSchema: () => unknown }
            ).toJsonSchema?.() ?? {},
          )
        : undefined
      : undefined;

    const body: Record<string, unknown> = {
      model: provider.model,
      messages,
      temperature: request.temperature ?? provider.temperature ?? 0.4,
      max_tokens: request.maxTokens ?? provider.maxTokens ?? 4096,
    };
    if (schemaJson) {
      body.response_format = {
        type: "json_schema",
        json_schema: { name: "structured_output", schema: schemaJson },
      };
    }

    const abortController = new AbortController();
    const timeout = setTimeout(
      () => abortController.abort(),
      provider.timeoutMs ?? 60000,
    );

    try {
      const httpResponse = await this.fetchFn(
        `${provider.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${provider.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: abortController.signal,
        },
      );

      clearTimeout(timeout);

      if (!httpResponse.ok) {
        const errorText = await httpResponse.text();
        const error = new Error(
          `LLM API error: ${httpResponse.status} ${errorText}`,
        );
        if (isRetryable(httpResponse.status)) {
          return null;
        }
        return { success: false, error };
      }

      const data = (await httpResponse.json()) as ChatCompletionResponse;
      const content = data.choices?.[0]?.message?.content ?? "";
      const finishReason = data.choices?.[0]?.finish_reason ?? "stop";

      const modelId = provider.model as unknown as DomainModelId;
      const response = createLLMResponse(
        modelId,
        content,
        finishReason as LLMResponse["finishReason"],
        {
          usage: data.usage
            ? {
                promptTokens: data.usage.prompt_tokens,
                completionTokens: data.usage.completion_tokens,
                totalTokens: data.usage.total_tokens,
              }
            : undefined,
          metadata: {
            provider: provider.providerId,
            model: provider.model,
          },
        },
      );

      return { success: true, value: response };
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof DOMException && error.name === "AbortError") {
        return null;
      }
      throw error;
    }
  }
}
