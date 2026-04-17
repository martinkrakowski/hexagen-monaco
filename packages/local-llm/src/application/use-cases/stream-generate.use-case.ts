import type { Result } from "@hexagen/shared";
import type {
  LocalLLMProviderPort,
  LLMCompletionRequest,
  LLMCompletionResponse,
} from "../../domain/ports/index.js";

export interface StreamGenerateInput {
  request: LLMCompletionRequest;
}

export class StreamGenerateUseCase {
  constructor(private readonly llmProvider: LocalLLMProviderPort) {}

  async *execute(
    input: StreamGenerateInput,
  ): AsyncGenerator<Result<LLMCompletionResponse>> {
    try {
      const response = await this.llmProvider.complete(input.request);
      yield response;
    } catch (error) {
      yield {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }
}
