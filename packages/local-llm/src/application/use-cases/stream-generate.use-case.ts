import type { Result } from "@hexagen/shared";
import type {
  LocalLLMProviderPort,
  LLMCompletionRequest,
} from "../../domain/ports/index.js";

export interface StreamGenerateInput {
  request: LLMCompletionRequest;
}

export class StreamGenerateUseCase {
  constructor(private readonly llmProvider: LocalLLMProviderPort) {}

  async *execute(input: StreamGenerateInput): AsyncGenerator<Result<string>> {
    yield* this.llmProvider.streamComplete(input.request);
  }
}
