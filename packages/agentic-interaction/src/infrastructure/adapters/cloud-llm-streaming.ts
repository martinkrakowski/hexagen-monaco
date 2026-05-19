import type { Result } from "@hexagen/shared";
import type { LLMRequest } from "@hexagen/local-llm/client";
import type { ResolvedProvider } from "../../domain/provider-config";
import { resolveFallbackChain } from "../../domain/provider-config";
import {
  isRetryable,
  type CloudLLMPipelineAdapterConfig,
} from "./cloud-llm-types";

export { type CloudLLMPipelineAdapterConfig } from "./cloud-llm-types";

function getErrorStatus(error: Error): number | null {
  const match = error.message.match(/(\d{3})/);
  if (match) {
    const status = parseInt(match[1], 10);
    if (status >= 100 && status < 600) return status;
  }
  return null;
}

export async function* streamStructuredRequest(
  config: CloudLLMPipelineAdapterConfig,
  fetchFn: typeof fetch,
  request: LLMRequest,
): AsyncGenerator<Result<string>> {
  const providers = resolveFallbackChain(
    config.secretVault,
    config.fallbackChain,
  );
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
      for await (const result of streamProvider(fetchFn, provider, request)) {
        yield result;
        if (!result.success) {
          const err: Error =
            result.error instanceof Error
              ? result.error
              : new Error(String(result.error ?? "Unknown error"));
          lastError = err;
          const status = getErrorStatus(err);
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

async function* streamProvider(
  fetchFn: typeof fetch,
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

    const httpResponse = await fetchFn(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: abortController.signal,
    });

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
