import type { Result } from "@hexagen/shared";
import type { LLMRequest } from "@hexagen/local-llm/client";
import type { ResolvedProvider } from "../../domain/provider-config";
import { resolveFallbackChain } from "../../domain/provider-config";
import {
  isRetryable,
  type CloudLLMPipelineAdapterConfig,
} from "./cloud-llm-types";
import { reasoningBodyField } from "./cloud-llm-reasoning";

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
    let hadSuccess = false;
    let providerErrored = false;
    try {
      for await (const result of streamProvider(fetchFn, provider, request)) {
        if (!result.success) {
          const err: Error =
            result.error instanceof Error
              ? result.error
              : new Error(String(result.error ?? "Unknown error"));
          lastError = err;
          const status = getErrorStatus(err);
          // If we already streamed content from this provider, surface the
          // partial result and stop — switching providers mid-stream would
          // duplicate output.
          if (hadSuccess) {
            return;
          }
          if (!isRetryable(status ?? 0)) {
            yield result;
            return;
          }
          providerErrored = true;
          break;
        }
        yield result;
        hadSuccess = true;
      }
      if (!providerErrored) {
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
      if (hadSuccess) return;
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

  const body: Record<string, unknown> = {
    model: request.preferredCloudModel ?? provider.model,
    messages,
    temperature: request.temperature ?? provider.temperature ?? 0.4,
    max_tokens: request.maxTokens ?? provider.maxTokens ?? 4096,
    stream: true,
    ...reasoningBodyField(),
  };

  if (request.guidedJsonSchema) {
    body.extra_body = {
      guided_json: request.guidedJsonSchema,
    };
  }

  const MAX_RATE_LIMIT_RETRIES = 5;
  let rateLimitRetries = 0;

  try {
    const abortController = new AbortController();
    const timeout = setTimeout(
      () => abortController.abort(),
      provider.timeoutMs ?? 60000,
    );

    let httpResponse: Response;

    // Retry loop for rate limiting (429 responses)
    while (rateLimitRetries <= MAX_RATE_LIMIT_RETRIES) {
      httpResponse = await fetchFn(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });

      // Handle rate limiting with exponential backoff
      if (httpResponse.status === 429) {
        rateLimitRetries++;
        if (rateLimitRetries > MAX_RATE_LIMIT_RETRIES) {
          clearTimeout(timeout);
          const errorText = await httpResponse.text();
          const error = new Error(
            `LLM API rate limited (429) after ${MAX_RATE_LIMIT_RETRIES} retries: ${errorText}`,
          );
          yield { success: false, error };
          return;
        }

        const backoffMs = Math.min(
          1000 * Math.pow(2, rateLimitRetries - 1),
          30000,
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }

      break;
    }

    clearTimeout(timeout);

    if (!httpResponse!.ok) {
      const errorText = await httpResponse!.text();
      const error = new Error(
        `LLM API error: ${httpResponse!.status} ${errorText}`,
      );
      yield { success: false, error };
      return;
    }

    if (!httpResponse!.body) {
      yield { success: false, error: new Error("No response body") };
      return;
    }

    const reader = httpResponse!.body.getReader();
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
