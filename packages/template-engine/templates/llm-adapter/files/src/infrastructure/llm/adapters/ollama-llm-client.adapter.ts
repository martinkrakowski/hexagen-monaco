import type { ZodSchema } from "zod";
import type {
  LLMClientPort,
  LLMCallOptions,
  LLMResponse,
} from "../../../domain/ports/out/llm-client.port";
import { LLMServiceError } from "../errors/llm-errors";
import type { LLMError } from "../errors/llm-errors";
import { withRetry } from "../utils/retry";
import { withTimeout } from "../utils/timeout";
import { callStructured } from "../utils/structured-output";
import { parseIntSafe } from "../utils/parse-env";
import { MODELS } from "../constants/models";
import type { Result } from "../../../../shared/result";

const BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const DEFAULT_TIMEOUT = parseIntSafe(process.env.LLM_DEFAULT_TIMEOUT_MS, 30000, 1);

export class OllamaLLMClientAdapter implements LLMClientPort {
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
    const model = options.model ?? MODELS.ollama.fast;
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
      stream: false,
      options: {
        num_predict: options.maxTokens ?? 4096,
        temperature: options.temperature ?? 0.7,
      },
    });

    try {
      const response = await withTimeout(
        (signal) =>
          fetch(`${BASE_URL}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            signal,
          }),
        timeoutMs,
      );

      if (!response.ok) {
        return {
          success: false,
          error: new LLMServiceError(`Ollama error (HTTP ${response.status})`),
        };
      }

      const data = await response.json();
      const content = data.message?.content ?? "";
      const evalCount = data.eval_count ?? 0;
      const promptEvalCount = data.prompt_eval_count ?? 0;

      return {
        success: true,
        value: {
          content,
          model: data.model ?? model,
          usage: {
            promptTokens: promptEvalCount,
            completionTokens: evalCount,
            totalTokens: promptEvalCount + evalCount,
          },
        },
      };
    } catch (e) {
      if (e instanceof Error && e.name === "LLMTimeoutError") {
        return { success: false, error: e as LLMError };
      }
      return { success: false, error: new LLMServiceError("Ollama request failed", e) };
    }
  }
}
