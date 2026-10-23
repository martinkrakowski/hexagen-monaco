import type { Result } from "@hexagen/shared";
import type { LLMRequest } from "@hexagen/local-llm/client";
import type { ResolvedProvider } from "../../domain/provider-config";
import { resolveFallbackChain } from "../../domain/provider-config";
import {
  isRetryable,
  type CloudLLMPipelineAdapterConfig,
} from "./cloud-llm-types";
import { reasoningBodyFieldFor } from "./cloud-llm-reasoning";
import { clampTemperatureFor } from "./cloud-llm-temperature";
import { type Span, SpanStatusCode, trace } from "@opentelemetry/api";
import { recordLlmUsage, type LlmUsage } from "../telemetry/llm-span";

export { type CloudLLMPipelineAdapterConfig } from "./cloud-llm-types";

/**
 * Holder shared between the wrapper and the inner generator: usage chunks the
 * provider may send, the provider that actually served (reported on its first
 * parsed frame), and a failure the inner generator swallows after partial
 * output — the wrapper still needs it to mark the span ERROR.
 */
interface UsageHolder {
  usage?: LlmUsage;
  servedBy?: { provider: string; model: string };
  streamError?: Error;
}

function getErrorStatus(error: Error): number | null {
  const match = error.message.match(/(\d{3})/);
  if (match) {
    const status = parseInt(match[1], 10);
    if (status >= 100 && status < 600) return status;
  }
  return null;
}

/**
 * The error of the last failed attempt, carried between providers so the
 * chain can yield it if every provider fails.
 */
interface FallbackState {
  lastError: Error | null;
}

/**
 * What one provider's streaming attempt means for the fallback chain:
 * - `"served"` — the provider completed the stream; the request is done.
 * - `"stop"` — the attempt ended the request (a fatal failure, a failure
 *   after partial output, or an abort); no further provider is tried.
 * - `"next"` — the attempt failed before any output; try the next provider.
 */
type ProviderStreamOutcome = "served" | "stop" | "next";

/**
 * What a failure frame yielded by `streamProvider` means:
 * - `"record-and-stop"` — after partial output: record the failure (the
 *   wrapper's span must still end ERROR) and keep the output.
 * - `"yield-and-stop"` — a non-retryable status: surface the failure.
 * - `"next"` — a retryable status: try the next provider.
 */
type FrameAction = "record-and-stop" | "yield-and-stop" | "next";

export async function* streamStructuredRequest(
  config: CloudLLMPipelineAdapterConfig,
  fetchFn: typeof fetch,
  request: LLMRequest,
): AsyncGenerator<Result<string>> {
  const primary = config.fallbackChain.primary;
  const model = request.preferredCloudModel ?? primary.model;
  const span = trace.getTracer("hexagen").startSpan("llm.chat.stream", {
    attributes: {
      "openinference.span.kind": "LLM",
      "llm.provider": primary.providerId,
      "llm.provider.primary": primary.providerId,
      "llm.system": primary.providerId,
      "llm.model_name": model,
      "gen_ai.system": primary.providerId,
      "gen_ai.request.model": model,
      "gen_ai.operation.name": "chat.stream",
    },
  });
  const usageHolder: UsageHolder = {};
  let sawFailure = false;
  try {
    for await (const result of streamStructuredRequestInner(
      config,
      fetchFn,
      request,
      usageHolder,
    )) {
      if (!result.success) {
        // The inner generator signals provider failure by yielding an
        // error value, not by throwing — mark the span ERROR here, with
        // the error's class name only.
        sawFailure = true;
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: errorName(result.error),
        });
      }
      yield result;
    }
    markStreamOk(span, sawFailure, usageHolder);
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: errorName(error),
    });
    throw error;
  } finally {
    finalizeStreamSpan(span, usageHolder);
  }
}

/**
 * Marks the stream span OK — but only once the inner generator is final
 * about failures: the SDK's `setStatus` ignores ERROR once the status is
 * OK (OK is sticky), so the OK may only be decided after the inner
 * generator has surfaced (or swallowed onto the holder) every failure.
 */
function markStreamOk(
  span: Span,
  sawFailure: boolean,
  usageHolder: UsageHolder,
): void {
  if (sawFailure || usageHolder.streamError) {
    return;
  }
  span.setStatus({ code: SpanStatusCode.OK });
}

/**
 * The ERROR status message for a failed stream: the error's class name
 * only — never its message body, which can carry a provider payload.
 */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "Error";
}

/**
 * Ends the stream span with everything the usage holder collected:
 * attributes for the provider that actually streamed the output (with a
 * fallback chain that is not necessarily the primary, which stays
 * recorded as `llm.provider.primary`), usage from a usage chunk, and the
 * ERROR a post-partial failure recorded — without that, a failure the
 * inner generator swallowed to preserve partial output would end the span
 * OK. The span always ends, whatever happened before.
 */
function finalizeStreamSpan(span: Span, usageHolder: UsageHolder): void {
  if (usageHolder.servedBy) {
    span.setAttributes({
      "llm.provider": usageHolder.servedBy.provider,
      "llm.system": usageHolder.servedBy.provider,
      "llm.model_name": usageHolder.servedBy.model,
      "gen_ai.system": usageHolder.servedBy.provider,
      "gen_ai.request.model": usageHolder.servedBy.model,
    });
  }
  if (usageHolder.usage) {
    recordLlmUsage(span, usageHolder.usage);
  }
  if (usageHolder.streamError) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: usageHolder.streamError.name,
    });
  }
  span.end();
}

async function* streamStructuredRequestInner(
  config: CloudLLMPipelineAdapterConfig,
  fetchFn: typeof fetch,
  request: LLMRequest,
  usageHolder: UsageHolder,
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

  const state: FallbackState = { lastError: null };
  for (const provider of providers) {
    const outcome = yield* tryStreamProvider(
      fetchFn,
      provider,
      request,
      usageHolder,
      state,
    );
    if (outcome !== "next") {
      return;
    }
  }

  if (state.lastError) {
    yield { success: false, error: state.lastError };
  }
}

/**
 * Streams one provider's attempt, delegating the wire work to
 * `streamProvider` and deciding what a yielded failure or a throw means
 * for the fallback chain.
 */
async function* tryStreamProvider(
  fetchFn: typeof fetch,
  provider: ResolvedProvider,
  request: LLMRequest,
  usageHolder: UsageHolder,
  state: FallbackState,
): AsyncGenerator<Result<string>, ProviderStreamOutcome> {
  let hadSuccess = false;
  try {
    for await (const result of streamProvider(
      fetchFn,
      provider,
      request,
      usageHolder,
    )) {
      if (!result.success) {
        const error = yieldedError(result.error);
        state.lastError = error;
        const action = failureAction(error, hadSuccess);
        if (action === "record-and-stop") {
          usageHolder.streamError = error;
          return "stop";
        }
        if (action === "yield-and-stop") {
          yield result;
          return "stop";
        }
        return "next";
      }
      yield result;
      hadSuccess = true;
    }
    return "served";
  } catch (error) {
    if (isAbortError(error)) {
      yield { success: false, error: thrownError(error) };
      return "stop";
    }
    const normalized = thrownError(error);
    state.lastError = normalized;
    return thrownOutcome(normalized, hadSuccess, usageHolder);
  }
}

/**
 * What a failure frame means for the chain: after partial output the
 * failure is recorded (the wrapper's span still ends ERROR) and the
 * request stops — switching providers mid-stream would duplicate the
 * output; a non-retryable status is surfaced to the caller; a retryable
 * status moves on to the next provider.
 */
function failureAction(error: Error, hadSuccess: boolean): FrameAction {
  if (hadSuccess) {
    return "record-and-stop";
  }
  if (!isRetryable(getErrorStatus(error) ?? 0)) {
    return "yield-and-stop";
  }
  return "next";
}

/**
 * What a value thrown out of a provider stream means: after partial
 * output the failure is recorded for the wrapper's span and the request
 * stops (the partial output is the result); otherwise the next provider
 * is tried.
 */
function thrownOutcome(
  error: Error,
  hadSuccess: boolean,
  usageHolder: UsageHolder,
): ProviderStreamOutcome {
  if (hadSuccess) {
    usageHolder.streamError = error;
    return "stop";
  }
  return "next";
}

/** The error value a failure frame carries: Errors as-is, the rest stringified. */
function yieldedError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error ?? "Unknown error"));
}

/** A value thrown by a provider stream: Errors as-is, the rest stringified. */
function thrownError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function* streamProvider(
  fetchFn: typeof fetch,
  provider: ResolvedProvider,
  request: LLMRequest,
  usageHolder: UsageHolder,
): AsyncGenerator<Result<string>> {
  const messages = request.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const requestedModel = request.preferredCloudModel ?? provider.model;
  const body: Record<string, unknown> = {
    model: requestedModel,
    messages,
    temperature: clampTemperatureFor(
      provider,
      request.temperature ?? provider.temperature ?? 0.4,
    ),
    max_tokens: request.maxTokens ?? provider.maxTokens ?? 4096,
    stream: true,
    ...reasoningBodyFieldFor(provider),
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
    // Report model identity once per serving provider, on the first parsed
    // SSE frame: only a provider that actually streams output counts as the
    // one that served (a 4xx/5xx attempt above never reaches this point).
    // OpenAI-compatible frames echo the resolved model; fall back to what we
    // asked for when the provider omits it. Fire-once means a model field
    // appearing only on LATER frames is ignored — accepted trade-off, since
    // OpenAI-compatible providers echo it on every frame.
    let modelReported = false;

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
          const maybeUsage = (parsed as { usage?: LlmUsage }).usage;
          if (maybeUsage && typeof maybeUsage === "object") {
            usageHolder.usage = maybeUsage;
          }
          if (!modelReported) {
            modelReported = true;
            const servedModel =
              typeof parsed.model === "string" && parsed.model
                ? parsed.model
                : requestedModel;
            // The serving provider's identity, recorded once on its first
            // parsed frame — the wrapper re-attributes the span with it
            // when the stream ends.
            usageHolder.servedBy = {
              provider: provider.providerId,
              model: servedModel,
            };
            // Observability side-channel: a throwing caller callback must
            // not affect delivery — unisolated it would be swallowed by the
            // JSON catch below and silently drop this frame's content.
            try {
              request.onModelResolved?.({
                provider: provider.providerId,
                model: servedModel,
              });
            } catch {
              // Ignore callback errors.
            }
          }
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
