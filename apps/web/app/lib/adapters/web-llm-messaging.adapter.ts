import type { LocalLlmMessagingPort } from "@hexagen/manifest-generation";
import type {
  SendStructuredRequestPort,
  DomainModelId,
  LLMRequest,
} from "@hexagen/local-llm";
import {
  FreeFormStringSchema,
  DEFAULT_TUNING_CONFIG,
} from "@hexagen/local-llm";

export class WebLlmMessagingAdapter implements LocalLlmMessagingPort {
  constructor(
    private readonly port: SendStructuredRequestPort,
    private readonly defaultModelId: DomainModelId = "qwen-coder-3b" as DomainModelId,
  ) {}

  async sendStructuredPrompt(
    userPrompt: string,
    systemPrompt: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const request: LLMRequest = {
      id: `manifest-${Date.now()}`,
      modelId: this.defaultModelId,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      schema: FreeFormStringSchema,
      temperature: DEFAULT_TUNING_CONFIG.temperature,
      maxTokens: DEFAULT_TUNING_CONFIG.maxTokens,
      topP: DEFAULT_TUNING_CONFIG.topP,
      stream: true,
      signal,
    };

    let collected = "";
    const stream = this.port.streamStructuredRequest(request);

    for await (const result of stream) {
      if (signal?.aborted) break;
      if (result.success) {
        collected += result.value;
      } else {
        throw result.error;
      }
    }

    if (!collected) throw new Error("No response from model.");
    return collected;
  }
}
