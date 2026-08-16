// @hexagen-server-only — uses the AWS SDK + Node credential chain; never import
// from a client bundle (ADR-0037).
import type { ZodSchema } from "zod";
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import type {
  LLMClientPort,
  LLMCallOptions,
  LLMResponse,
} from "../../../domain/ports/out/llm-client.port";
import type { LLMError } from "../../../domain/errors/llm-error";
import { classifyAwsError } from "../errors/bedrock-errors";
import { withRetry } from "../utils/retry";
import { withTimeout } from "../utils/timeout";
import { callStructured } from "../utils/structured-output";
import { parseIntSafe } from "../utils/parse-env";
import type { Result } from "../../../../shared/result";

const DEFAULT_TIMEOUT = parseIntSafe(
  process.env.LLM_DEFAULT_TIMEOUT_MS,
  30000,
  1,
);
const DEFAULT_MODEL = process.env.BEDROCK_FAST_MODEL ?? "{bedrock_inference}";

/**
 * Region resolution: let the AWS SDK cascade win (env -> shared profile ->
 * IMDS/IRSA on Graviton/ECS). Only pin a region when the user explicitly set
 * one — a hardcoded literal would silently mis-region in-cluster.
 */
function resolveRegion(): string | undefined {
  return process.env.BEDROCK_REGION ?? process.env.AWS_REGION ?? undefined;
}

export class BedrockLLMClientAdapter implements LLMClientPort {
  private readonly client: BedrockRuntimeClient;

  constructor(client?: BedrockRuntimeClient) {
    const region = resolveRegion();
    this.client = client ?? new BedrockRuntimeClient(region ? { region } : {});
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
    const modelId = options.model ?? DEFAULT_MODEL;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
    const guardrailId = process.env.BEDROCK_GUARDRAIL_ID;

    try {
      const response = await withTimeout(
        (signal) =>
          this.client.send(
            // ConverseCommand is provider-agnostic across Bedrock model families
            // (Claude, Nova, Llama, …) — preferred over InvokeModel.
            new ConverseCommand({
              modelId,
              messages: [{ role: "user", content: [{ text: prompt }] }],
              ...(options.systemPrompt
                ? { system: [{ text: options.systemPrompt }] }
                : {}),
              inferenceConfig: {
                maxTokens: options.maxTokens ?? 4096,
                temperature: options.temperature ?? 0.7,
              },
              ...(guardrailId
                ? {
                    guardrailConfig: {
                      guardrailIdentifier: guardrailId,
                      guardrailVersion:
                        process.env.BEDROCK_GUARDRAIL_VERSION ?? "DRAFT",
                    },
                  }
                : {}),
            }),
            { abortSignal: signal },
          ),
        timeoutMs,
      );

      // Converse can return non-text blocks (e.g. `toolUse`), but LLMClientPort
      // is text / structured-output focused, so concatenate text blocks only.
      const content =
        response.output?.message?.content
          ?.map((block) => block.text ?? "")
          .join("") ?? "";

      return {
        success: true,
        value: {
          content,
          model: modelId,
          usage: {
            promptTokens: response.usage?.inputTokens ?? 0,
            completionTokens: response.usage?.outputTokens ?? 0,
            totalTokens: response.usage?.totalTokens ?? 0,
          },
        },
      };
    } catch (e) {
      // withTimeout throws LLMTimeoutError directly; preserve it.
      if (e instanceof Error && e.name === "LLMTimeoutError") {
        return { success: false, error: e as LLMError };
      }
      return { success: false, error: classifyAwsError(e) };
    }
  }
}
