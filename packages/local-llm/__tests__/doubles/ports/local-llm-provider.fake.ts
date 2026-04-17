import type {
  LocalLLMProviderPort,
  LLMCompletionRequest,
  LLMCompletionResponse,
} from "../../../src/domain/ports/index.js";
import type {
  LLMProgressCallback,
  ModelConfig,
  ModelMetadata,
} from "../../../src/domain/value-objects/index.js";

export type FakeLocalLLMProviderConfig = {
  initializeResult?: { success: boolean; error?: Error };
  completeResult?: {
    success: boolean;
    value?: LLMCompletionResponse;
    error?: Error;
  };
  loadedModelMetadata?: ModelMetadata | null;
  streamChunks?: string[];
  streamError?: Error;
  disposeError?: Error;
};

export class FakeLocalLLMProviderPort implements LocalLLMProviderPort {
  private config: FakeLocalLLMProviderConfig;
  private disposed = false;

  constructor(config: FakeLocalLLMProviderConfig = {}) {
    this.config = config;
  }

  async initialize(
    _config: ModelConfig,
    onProgress: LLMProgressCallback,
  ): Promise<{ success: boolean; error?: Error }> {
    if (this.disposed) {
      return { success: false, error: new Error("Provider already disposed") };
    }
    if (this.config.initializeResult) {
      return this.config.initializeResult;
    }
    const progress = { phase: "ready" as const, progress: 1, text: "" };
    onProgress(progress);
    return { success: true };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async complete(_request: LLMCompletionRequest): Promise<{
    success: boolean;
    value?: LLMCompletionResponse;
    error?: Error;
  }> {
    if (this.disposed) {
      return { success: false, error: new Error("Provider already disposed") };
    }
    if (this.config.completeResult) {
      return this.config.completeResult;
    }
    return {
      success: true,
      value: {
        id: "fake-completion",
        model: this.config.loadedModelMetadata?.modelId ?? "test-model",
        choices: [
          {
            message: { role: "assistant", content: "This is a fake response" },
            finishReason: "stop",
          },
        ],
      },
    };
  }

  async *streamComplete(
    /* eslint-disable @typescript-eslint/no-unused-vars */
    _request: LLMCompletionRequest,
  ): AsyncGenerator<{ success: boolean; value?: string; error?: Error }> {
    if (this.disposed) {
      yield { success: false, error: new Error("Provider already disposed") };
      return;
    }
    if (this.config.streamError) {
      yield { success: false, error: this.config.streamError };
      return;
    }
    const chunks = this.config.streamChunks ?? [
      "This ",
      "is ",
      "a ",
      "fake ",
      "stream.",
    ];
    for (const chunk of chunks) {
      yield { success: true, value: chunk };
    }
  }

  getLoadedModel(): ModelMetadata | null {
    return this.config.loadedModelMetadata ?? null;
  }

  dispose(): void {
    if (this.disposeError) {
      throw this.disposeError;
    }
    this.disposed = true;
  }
}
