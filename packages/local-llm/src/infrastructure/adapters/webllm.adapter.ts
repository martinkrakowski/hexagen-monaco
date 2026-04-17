import { ok, err, type Result } from "@hexagen/shared";
import type {
  LocalLLMProviderPort,
  LLMCompletionRequest,
  LLMCompletionResponse,
} from "../../domain/ports/index.js";
import type {
  LLMProgress,
  LLMProgressCallback,
  ModelConfig,
  ModelMetadata,
} from "../../domain/value-objects/index.js";
import { DEFAULT_MODEL_ID } from "../../domain/value-objects/index.js";

export interface WebLLMAdapterConfig {
  defaultModelId?: string;
  /**
   * Factory that creates the WebLLM Worker.
   * In Next.js (webpack 5) supply this via new URL() so the worker is bundled:
   *   createWorker: () => new Worker(new URL('../workers/webllm.worker.ts', import.meta.url), { type: 'module' })
   */
  createWorker?: () => Worker;
}

type WorkerMessage =
  | { type: "progress"; data: LLMProgress }
  | { type: "ready" }
  | { type: "result"; data: string }
  | { type: "chunk"; data: string }
  | { type: "done" }
  | { type: "error"; data: string };

export class WebLLMAdapter implements LocalLLMProviderPort {
  private loadedModelId: string | null = null;
  private progressCallback: LLMProgressCallback | null = null;
  private worker: Worker | null = null;
  private config: WebLLMAdapterConfig;

  constructor(config: WebLLMAdapterConfig = {}) {
    this.config = {
      defaultModelId: config.defaultModelId ?? DEFAULT_MODEL_ID,
      createWorker: config.createWorker,
    };
  }

  async initialize(
    config: ModelConfig,
    onProgress: LLMProgressCallback,
  ): Promise<Result<void>> {
    try {
      const { createWorker } = this.config;
      if (!createWorker) {
        return err(
          new Error(
            "WebLLMAdapter requires a createWorker factory. " +
              "Provide one via WebLLMAdapterConfig.createWorker.",
          ),
        );
      }

      this.progressCallback = onProgress;
      const modelId = config.modelId || this.config.defaultModelId!;

      this.worker = createWorker();

      return new Promise((resolve) => {
        if (!this.worker) {
          resolve(err(new Error("Failed to create worker")));
          return;
        }

        const messageHandler = (e: MessageEvent) => {
          const msg = e.data as WorkerMessage;
          if (msg.type === "progress") {
            if (this.progressCallback) {
              this.progressCallback(msg.data);
            }
          } else if (msg.type === "ready") {
            this.loadedModelId = modelId;
            resolve(ok(undefined));
          } else if (msg.type === "error") {
            resolve(
              err(new Error(`WebLLM initialization failed: ${msg.data}`)),
            );
          }
        };

        this.worker.addEventListener("message", messageHandler);
        this.worker.postMessage({ type: "init", data: { modelId } });
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async complete(
    request: LLMCompletionRequest,
  ): Promise<Result<LLMCompletionResponse>> {
    if (!this.worker || !this.loadedModelId) {
      return err(new Error("Engine not initialized. Call initialize() first."));
    }

    return new Promise((resolve) => {
      if (!this.worker) {
        resolve(err(new Error("Worker not available")));
        return;
      }

      const timeoutId = setTimeout(() => {
        resolve(err(new Error("Completion request timed out")));
      }, 120000);

      const messageHandler = (e: MessageEvent) => {
        const msg = e.data as WorkerMessage;
        if (msg.type === "result") {
          clearTimeout(timeoutId);
          this.worker?.removeEventListener("message", messageHandler);
          const response: LLMCompletionResponse = {
            id: `webllm-${Date.now()}`,
            model: this.loadedModelId!,
            choices: [
              {
                message: {
                  role: "assistant",
                  content: msg.data as string,
                },
                finishReason: "stop",
              },
            ],
          };
          resolve(ok(response));
        } else if (msg.type === "error") {
          clearTimeout(timeoutId);
          this.worker?.removeEventListener("message", messageHandler);
          resolve(err(new Error(`Generation failed: ${msg.data}`)));
        }
      };

      this.worker.addEventListener("message", messageHandler);

      this.worker.postMessage({
        type: "generate",
        data: {
          messages: request.messages,
          temperature: request.temperature ?? 0.6,
          maxTokens: request.maxTokens ?? 768,
          topP: request.topP,
          topK: request.topK,
          frequencyPenalty: request.frequencyPenalty,
          presencePenalty: request.presencePenalty,
          repetitionPenalty: request.repetitionPenalty,
          stream: false,
        },
      });
    });
  }

  async *streamComplete(
    request: LLMCompletionRequest,
  ): AsyncGenerator<Result<string>> {
    if (!this.worker || !this.loadedModelId) {
      yield err(new Error("Engine not initialized. Call initialize() first."));
      return;
    }

    // FIFO queue + notify pattern: the Worker message handler (producer) enqueues
    // items; the async generator loop (consumer) drains them. A single `notify`
    // callback is stored so the consumer can await the next item without polling.
    // This avoids the dual-path (resolveNext / pendingChunks) race where a chunk
    // arriving between `if (resolveNext)` and `else` could be handled by both
    // branches on a microtask boundary.
    type QueueItem =
      | { kind: "chunk"; value: string }
      | { kind: "done" }
      | { kind: "error"; error: Error };

    const queue: QueueItem[] = [];
    let notify: (() => void) | null = null;

    const enqueue = (item: QueueItem) => {
      queue.push(item);
      if (notify) {
        const fn = notify;
        notify = null;
        fn();
      }
    };

    const messageHandler = (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data;
      if (msg.type === "chunk") {
        enqueue({ kind: "chunk", value: msg.data as string });
      } else if (msg.type === "done") {
        enqueue({ kind: "done" });
      } else if (msg.type === "error") {
        enqueue({
          kind: "error",
          error: new Error(`Generation failed: ${msg.data}`),
        });
      }
    };

    const timeoutId = setTimeout(() => {
      enqueue({
        kind: "error",
        error: new Error("Streaming request timed out"),
      });
    }, 120000);

    try {
      this.worker.addEventListener("message", messageHandler);
      this.worker.postMessage({
        type: "generate",
        data: {
          messages: request.messages,
          temperature: request.temperature ?? 0.6,
          maxTokens: request.maxTokens ?? 768,
          topP: request.topP,
          topK: request.topK,
          frequencyPenalty: request.frequencyPenalty,
          presencePenalty: request.presencePenalty,
          repetitionPenalty: request.repetitionPenalty,
          stream: true,
        },
      });

      while (true) {
        while (queue.length > 0) {
          const item = queue.shift()!;
          if (item.kind === "chunk") {
            yield ok(item.value);
          } else if (item.kind === "done") {
            return;
          } else {
            yield err(item.error);
            return;
          }
        }
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
      }
    } finally {
      clearTimeout(timeoutId);
      this.worker?.removeEventListener("message", messageHandler);
    }
  }

  getLoadedModel(): ModelMetadata | null {
    if (!this.loadedModelId) return null;

    return {
      modelId: this.loadedModelId,
      vendor: "Alibaba",
      parameterSize: "3B",
      quantizeLevel: "q4f16_1",
      contextLength: 32768,
      vocabularySize: 151936,
      recommendedTemperature: 0.6,
      isLoaded: true,
    };
  }

  dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.loadedModelId = null;
    this.progressCallback = null;
  }
}
