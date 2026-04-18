import { ok, err, type Result } from "@hexagen/shared";
import type {
  LocalLLMProviderPort,
  LLMCompletionRequest,
  LLMCompletionResponse,
} from "../../../src/domain/ports/index.js";
import type {
  DomainModelId,
  LLMInitializeConfig,
  LLMProgressCallback,
  ModelMetadata,
} from "../../../src/domain/value-objects/index.js";

export type FakeLocalLLMProviderConfig = {
  initializeResult?: Result<void>;
  completeResult?: Result<LLMCompletionResponse>;
  loadedModelMetadata?: ModelMetadata | null;
  streamChunks?: string[];
  streamError?: Error;
};

export class FakeLocalLLMProviderPort implements LocalLLMProviderPort {
  private config: FakeLocalLLMProviderConfig;
  private disposed = false;

  constructor(config: FakeLocalLLMProviderConfig = {}) {
    this.config = config;
  }

  async initialize(
    _config: LLMInitializeConfig,
    onProgress: LLMProgressCallback,
  ): Promise<Result<void>> {
    if (this.disposed) {
      return err(new Error("Provider already disposed"));
    }
    if (this.config.initializeResult) {
      return this.config.initializeResult;
    }
    const progress = { phase: "ready" as const, progress: 1, text: "" };
    onProgress(progress);
    return ok(undefined);
  }

  async complete(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _request: LLMCompletionRequest,
  ): Promise<Result<LLMCompletionResponse>> {
    if (this.disposed) {
      return err(new Error("Provider already disposed"));
    }
    if (this.config.completeResult) {
      return this.config.completeResult;
    }
    return ok({
      id: "fake-completion",
      modelId:
        this.config.loadedModelMetadata?.modelId ??
        ("test-model" as DomainModelId),
      choices: [
        {
          message: { role: "assistant", content: "This is a fake response" },
          finishReason: "stop",
        },
      ],
    });
  }

  async *streamComplete(
    /* eslint-disable @typescript-eslint/no-unused-vars */
    _request: LLMCompletionRequest,
  ): AsyncGenerator<Result<string>> {
    if (this.disposed) {
      yield err(new Error("Provider already disposed"));
      return;
    }
    if (this.config.streamError) {
      yield err(this.config.streamError);
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
      yield ok(chunk);
    }
  }

  getLoadedModel(): ModelMetadata | null {
    return this.config.loadedModelMetadata ?? null;
  }

  async hasModelInCache(modelId: DomainModelId): Promise<boolean> {
    // Fake implementation: assume all models are cached
    return true;
  }

  async deleteCachedModel(modelId: DomainModelId): Promise<void> {
    // Fake implementation: no-op
    return;
  }

  dispose(): void {
    this.disposed = true;
  }
}
