import type { Result } from "@hexagen/shared";
import type {
  SendStructuredRequestPort,
  LLMRequest,
  LLMResponse,
} from "@hexagen/local-llm";
import { createLLMResponse } from "@hexagen/local-llm";
import type { DomainModelId } from "@hexagen/local-llm";
import type { ResolvedProvider } from "../../domain/provider-config.js";
import { resolveFallbackChain } from "../../domain/provider-config.js";
import {
  isRetryable,
  type CloudLLMPipelineAdapterConfig,
  type ChatCompletionResponse,
} from "./cloud-llm-types.js";
import { streamStructuredRequest as streamStructuredRequestImpl } from "./cloud-llm-streaming.js";

export type { CloudLLMPipelineAdapterConfig } from "./cloud-llm-types.js";

export class CloudLLMPipelineAdapter implements SendStructuredRequestPort {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly config: CloudLLMPipelineAdapterConfig) {
    this.fetchFn = config.fetchFn ?? globalThis.fetch;
  }

  async sendRequest(request: LLMRequest): Promise<Result<LLMResponse>> {
    const providers = resolveFallbackChain(
      this.config.secretVault,
      this.config.fallbackChain,
    );
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
    yield* streamStructuredRequestImpl(this.config, this.fetchFn, request);
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

    const requestAbortHandler = () => abortController.abort();
    request.signal?.addEventListener("abort", requestAbortHandler);

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
      request.signal?.removeEventListener("abort", requestAbortHandler);

      if (!httpResponse.ok) {
        const errorText = await httpResponse.text();
        const error = new Error(
          `LLM API error: ${httpResponse.status} ${errorText}`,
        ) as Error & { statusCode?: number };
        error.statusCode = httpResponse.status;
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
      request.signal?.removeEventListener("abort", requestAbortHandler);
      if (error instanceof DOMException && error.name === "AbortError") {
        return null;
      }
      throw error;
    }
  }
}
