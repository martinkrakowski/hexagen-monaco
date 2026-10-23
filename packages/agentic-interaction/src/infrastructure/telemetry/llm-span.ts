import {
  type Attributes,
  type Span,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import type { Result } from "@hexagen/shared";

/**
 * The OpenInference span-kind value used for every LLM span this package emits.
 */
export const LLM_SPAN_KIND = "LLM" as const;

/**
 * An OpenAI-style usage object (as returned by chat-completions endpoints).
 * Every field is optional: only the numbers the provider actually sent are
 * recorded on the span.
 */
export interface LlmUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

/**
 * Runs `fn` inside an active span named `name` and ends it.
 *
 * Span lifecycle:
 * - `openinference.span.kind` is always `LLM`; remaining attributes come from
 *   `attrs` (model, provider, system, operation name, …).
 * - On success the span ends with status OK.
 * - When `failed` is given, a resolved value it reports as a failure marks
 *   the span ERROR — call sites whose `fn` returns a `Result` use this so
 *   failures returned as values are not recorded as OK.
 * - On any throw the span ends with status ERROR and `message` set to the
 *   error's class name only (never its message body — provider payloads must
 *   not leak into telemetry). The error is rethrown.
 *
 * Adapters only ever call this through `@opentelemetry/api`; without a
 * registered tracer provider the API is a no-op, so behaviour is exactly as
 * today when no OTLP endpoint is configured.
 */
export function withLlmSpan<T>(
  name: string,
  attrs: Attributes,
  fn: (span: Span) => T | Promise<T>,
  failed?: (result: T) => { name: string } | undefined,
): Promise<T> {
  const tracer = trace.getTracer("hexagen");
  return tracer.startActiveSpan(
    name,
    {
      attributes: {
        "openinference.span.kind": LLM_SPAN_KIND,
        ...attrs,
      },
    },
    async (span) => {
      try {
        const result = await fn(span);
        const failure = failed?.(result);
        if (failure) {
          // A failure returned as a value (a Result error side) marks the
          // span ERROR; the message is the failure's class name only.
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: typeof failure.name === "string" ? failure.name : "Error",
          });
        } else {
          span.setStatus({ code: SpanStatusCode.OK });
        }
        return result;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.name : "Error",
        });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

/**
 * Records token counts from an OpenAI-style `usage` object onto `span`.
 *
 * Writes the OpenInference `llm.token_count.*` and `gen_ai.usage.*`
 * attributes. Missing fields are skipped — only numbers are ever recorded.
 */
export function recordLlmUsage(span: Span, usage: LlmUsage): void {
  if (typeof usage.prompt_tokens === "number") {
    span.setAttribute("llm.token_count.prompt", usage.prompt_tokens);
    span.setAttribute("gen_ai.usage.input_tokens", usage.prompt_tokens);
  }
  if (typeof usage.completion_tokens === "number") {
    span.setAttribute("llm.token_count.completion", usage.completion_tokens);
    span.setAttribute("gen_ai.usage.output_tokens", usage.completion_tokens);
  }
  if (typeof usage.total_tokens === "number") {
    span.setAttribute("llm.token_count.total", usage.total_tokens);
  }
}

/**
 * `withLlmSpan`'s `failed` callback for call sites whose `fn` resolves a
 * `Result`: a success reports no failure, an `Error` failure reports the
 * error itself (its class name becomes the span's ERROR message), and any
 * other failure value reports the bare class name `Error`.
 *
 * Written with plain `if` statements — the nested-ternary form of this
 * mapping is flagged by Sonar (S3358), and every Result-returning call
 * site needs the exact same mapping.
 */
export function failureOfResult<T>(
  result: Result<T>,
): { name: string } | undefined {
  if (result.success) {
    return undefined;
  }
  if (result.error instanceof Error) {
    return result.error;
  }
  return { name: "Error" };
}
