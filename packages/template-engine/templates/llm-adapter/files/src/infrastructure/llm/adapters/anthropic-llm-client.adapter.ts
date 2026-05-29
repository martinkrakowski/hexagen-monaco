import type { ZodSchema } from "zod";
import type {
  LLMClientPort,
  LLMCallOptions,
  LLMResponse,
} from "../../../domain/ports/out/llm-client.port";
import { classifyHttpError, LLMServiceError } from "../errors/llm-errors";
import type { LLMError } from "../errors/llm-errors";
import { withRetry } from "../utils/retry";
import { withTimeout } from "../utils/timeout";
import { callStructured } from "../utils/structured-output";
import { MODELS } from "../constants/models";
import type { Result } from "../../../../shared/result";

const BASE_URL = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_TIMEOUT = parseInt(process.env.LLM_DEFAULT_TIMEOUT_MS ?? "30000", 10);

export class AnthropicLLMClientAdapter implements LLMClientPort {
  private readonly apiKey: string;

  constructor(apiKey = process.env.ANTHROPIC_API_KEY ?? "") {
    this.apiKey = apiKey;
  }

  async call(
    prompt: string,
    options: LLMCallOptions = {},
  ): Promise<Result<LLMResponse, LLMError>> {
    return withRetry(() => this.doCall(prompt, options));
  }

  async callStructured<T>(
    prompt: string,
    schema: ZodSchema<T>,
    options?: LLMCallOptions,
  ): Promise<Result<T, LLMError>> {
    return callStructured(this, prompt, schema, options);
  }

  private async doCall(
    prompt: string,
    options: LLMCallOptions,
  ): Promise<Result<LLMResponse, LLMError>> {
    const model = options.model ?? MODELS.anthropic.fast;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;

    const body = JSON.stringify({
      model,
      max_tokens: options.maxTokens ?? 4096,
      ...(options.systemPrompt ? { system: options.systemPrompt } : {}),
      messages: [{ role: "user", content: prompt }],
    });

    try {
      const response = await withTimeout(
        fetch(`${BASE_URL}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
          },
          body,
        }),
        timeoutMs,
      );

      if (!response.ok) {
        const retryAfter = response.headers.get("Retry-After");
        return { ok: false, error: classifyHttpError(response.status, retryAfter) };
      }

      const data = await response.json();
      const content = data.content?.[0]?.text ?? "";

      return {
        ok: true,
        value: {
          content,
          model: data.model ?? model,
          usage: {
            promptTokens: data.usage?.input_tokens ?? 0,
            completionTokens: data.usage?.output_tokens ?? 0,
            totalTokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
          },
        },
      };
    } catch (e) {
      if (e instanceof Error && e.name === "LLMTimeoutError") {
        return { ok: false, error: e as LLMError };
      }
      return { ok: false, error: new LLMServiceError("Anthropic request failed", e) };
    }
  }
}
