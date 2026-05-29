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
import { parseIntSafe } from "../utils/parse-env";
import { MODELS } from "../constants/models";
import type { Result } from "../../../../shared/result";

const BASE_URL = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_TIMEOUT = parseIntSafe(process.env.LLM_DEFAULT_TIMEOUT_MS, 30000, 1);

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
      temperature: options.temperature ?? 0.7,
      ...(options.systemPrompt ? { system: options.systemPrompt } : {}),
      messages: [{ role: "user", content: prompt }],
    });

    try {
      const response = await withTimeout(
        (signal) =>
          fetch(`${BASE_URL}/messages`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": this.apiKey,
              "anthropic-version": ANTHROPIC_VERSION,
            },
            body,
            signal,
          }),
        timeoutMs,
      );

      if (!response.ok) {
        const retryAfter = response.headers.get("Retry-After");
        return { success: false, error: classifyHttpError(response.status, retryAfter) };
      }

      const data = await response.json();
      const content = Array.isArray(data.content)
        ? data.content
            .filter(
              (block: unknown): block is { type: "text"; text: string } =>
                typeof block === "object" &&
                block !== null &&
                (block as { type?: string }).type === "text" &&
                typeof (block as { text?: string }).text === "string",
            )
            .map((block) => block.text)
            .join("")
        : "";

      return {
        success: true,
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
        return { success: false, error: e as LLMError };
      }
      return { success: false, error: new LLMServiceError("Anthropic request failed", e) };
    }
  }
}
