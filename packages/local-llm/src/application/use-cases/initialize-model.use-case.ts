import type { Result } from "@hexagen/shared";
import type { LocalLLMProviderPort } from "../../domain/ports/index.js";
import type {
  DomainModelId,
  LLMInitializeConfig,
  LLMProgressCallback,
} from "../../domain/value-objects/index.js";

export interface InitializeModelInput {
  config: LLMInitializeConfig;
  onProgress: LLMProgressCallback;
}

export interface InitializeModelOutput {
  initialized: boolean;
  modelId: DomainModelId;
  phase: string;
}

export class InitializeModelUseCase {
  constructor(private readonly llmProvider: LocalLLMProviderPort) {}

  async execute(
    input: InitializeModelInput,
  ): Promise<Result<InitializeModelOutput>> {
    try {
      const initResult = await this.llmProvider.initialize(
        input.config,
        input.onProgress,
      );

      if (!initResult.success) {
        return { success: false, error: initResult.error };
      }

      const metadata = this.llmProvider.getLoadedModel();
      if (!metadata) {
        return {
          success: false,
          error: new Error("Model initialization failed: no metadata returned"),
        };
      }

      return {
        success: true,
        value: {
          initialized: true,
          modelId: metadata.modelId,
          phase: "ready",
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }
}
