import type { Result } from "@hexagen/shared";
import type {
  SendStructuredRequestPort,
  LLMRequest,
  LLMResponse,
} from "@hexagen/local-llm/client";
import { createLLMResponse } from "@hexagen/local-llm/client";
import type { DomainModelId } from "@hexagen/local-llm/client";
import type { ResolvedProvider } from "../../domain/provider-config";
import { resolveFallbackChain } from "../../domain/provider-config";
import {
  isRetryable,
  type CloudLLMPipelineAdapterConfig,
  type ChatCompletionResponse,
} from "./cloud-llm-types";
import { streamStructuredRequest as streamStructuredRequestImpl } from "./cloud-llm-streaming";
import { reasoningBodyFieldFor } from "./cloud-llm-reasoning";
import { clampTemperatureFor } from "./cloud-llm-temperature";
import { ndjsonResponseFormatFor, unwrapNdjsonLines } from "./cloud-llm-ndjson";
import { recordLlmUsage, withLlmSpan } from "../telemetry/llm-span";

export type { CloudLLMPipelineAdapterConfig } from "./cloud-llm-types";

export class CloudLLMPipelineAdapter implements SendStructuredRequestPort {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly config: CloudLLMPipelineAdapterConfig) {
    this.fetchFn = config.fetchFn ?? globalThis.fetch;
  }

  async sendRequest(request: LLMRequest): Promise<Result<LLMResponse>> {
    const primary = this.config.fallbackChain.primary;
    const model = request.preferredCloudModel ?? primary.model;
    return withLlmSpan(
      "llm.chat",
      {
        "llm.provider": primary.providerId,
        "llm.provider.primary": primary.providerId,
        "llm.system": primary.providerId,
        "llm.model_name": model,
        "gen_ai.system": primary.providerId,
        "gen_ai.request.model": model,
        "gen_ai.operation.name": "chat",
      },
      async (span) => {
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
            if (response) {
              if (response.success) {
                if (response.value.usage) {
                  recordLlmUsage(span, {
                    prompt_tokens: response.value.usage.promptTokens,
                    completion_tokens: response.value.usage.completionTokens,
                    total_tokens: response.value.usage.totalTokens,
                  });
                }
                // Attribute the span to the provider and model that
                // actually answered — with a fallback chain that is not
                // necessarily the primary, which stays recorded as
                // llm.provider.primary. callProvider reports the serving
                // pair through the response's metadata.
                const meta = (response.value.metadata ?? {}) as {
                  provider?: string;
                  model?: string;
                };
                const servedProvider = meta.provider ?? provider.providerId;
                const servedModel =
                  meta.model ?? request.preferredCloudModel ?? provider.model;
                span.setAttributes({
                  "llm.provider": servedProvider,
                  "llm.system": servedProvider,
                  "llm.model_name": servedModel,
                  "gen_ai.system": servedProvider,
                  "gen_ai.request.model": servedModel,
                });
              }
              return response;
            }
          } catch (error) {
            lastError =
              error instanceof Error ? error : new Error(String(error));
            continue;
          }
        }

        return {
          success: false,
          error: lastError ?? new Error("All cloud LLM providers failed"),
        };
      },
      // A failure returned as a value (every provider failed, or the single
      // response was an error Result) must mark the span ERROR, not OK.
      (result) =>
        result.success
          ? undefined
          : result.error instanceof Error
            ? result.error
            : { name: "Error" },
    );
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

    const model = request.preferredCloudModel ?? provider.model;
    const ndjsonResponseFormat = ndjsonResponseFormatFor(provider, request);
    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: clampTemperatureFor(
        provider,
        request.temperature ?? provider.temperature ?? 0.4,
      ),
      max_tokens: request.maxTokens ?? provider.maxTokens ?? 4096,
      ...reasoningBodyFieldFor(provider),
      ...ndjsonResponseFormat,
    };

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
      const rawContent = data.choices?.[0]?.message?.content ?? "";
      // When this request enforced the NDJSON-lines schema, convert the
      // returned JSON array back to NDJSON text so the stages' line-oriented
      // parsers work unchanged; on shape mismatch fall back to the raw
      // content (the stage retry loop must see what the model actually said).
      const content =
        "response_format" in ndjsonResponseFormat
          ? (unwrapNdjsonLines(rawContent) ?? rawContent)
          : rawContent;
      const finishReason = data.choices?.[0]?.finish_reason ?? "stop";

      // Prefer the model echoed by the provider over the one requested —
      // the two differ when the endpoint aliases or rewrites model names.
      const servedModel =
        typeof data.model === "string" && data.model ? data.model : model;
      // Observability side-channel: a throwing caller callback must not
      // fail a valid provider response (the outer catch rethrows).
      try {
        request.onModelResolved?.({
          provider: provider.providerId,
          model: servedModel,
        });
      } catch {
        // Ignore callback errors.
      }

      const modelId = model as unknown as DomainModelId;
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
            model: servedModel,
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
