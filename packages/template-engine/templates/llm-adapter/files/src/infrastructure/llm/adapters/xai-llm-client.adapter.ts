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

const BASE_URL = process.env.XAI_BASE_URL ?? "https://api.x.ai/v1";
const DEFAULT_TIMEOUT = parseIntSafe(process.env.LLM_DEFAULT_TIMEOUT_MS, 30000, 1);

export class XaiLLMClientAdapter implements LLMClientPort {
  private readonly apiKey: string;

  constructor(apiKey = process.env.XAI_API_KEY ?? "") {
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
    const model = options.model ?? MODELS.xai.fast;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;

    const messages = [
      ...(options.systemPrompt
        ? [{ role: "system", content: options.systemPrompt }]
        : []),
      { role: "user", content: prompt },
    ];

    const body = JSON.stringify({
      model,
      messages,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0.7,
    });

    try {
      const response = await withTimeout(
        (signal) =>
          fetch(`${BASE_URL}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.apiKey}`,
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
      const choice = data.choices?.[0];

      return {
        success: true,
        value: {
          content: choice?.message?.content ?? "",
          model: data.model ?? model,
          usage: {
            promptTokens: data.usage?.prompt_tokens ?? 0,
            completionTokens: data.usage?.completion_tokens ?? 0,
            totalTokens: data.usage?.total_tokens ?? 0,
          },
        },
      };
    } catch (e) {
      if (e instanceof Error && e.name === "LLMTimeoutError") {
        return { success: false, error: e as LLMError };
      }
      return { success: false, error: new LLMServiceError("xAI request failed", e) };
    }
  }
}
