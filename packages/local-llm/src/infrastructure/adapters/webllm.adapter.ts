import { ok, err, type Result } from "@hexagen/shared";
import type {
  LocalLLMProviderPort,
  LLMCompletionRequest,
  LLMCompletionResponse,
} from "../../domain/ports/index.js";
import type {
  DomainModelId,
  LLMInitializeConfig,
  LLMProgress,
  LLMProgressCallback,
  ModelMetadata,
} from "../../domain/value-objects/index.js";
import { DEFAULT_MODEL_ID } from "../../domain/value-objects/model-id.vo.js";
import { MODEL_METADATA_MAP } from "../../domain/value-objects/model-metadata.vo.js";
import { domainIdToMlcId, mlcIdToDomainId } from "./webllm-model-mapper.js";

export interface WebLLMAdapterConfig {
  defaultModelId?: DomainModelId;
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
  private loadedModelId: DomainModelId | null = null;
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
    config: LLMInitializeConfig,
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
      const domainModelId = config.modelId || this.config.defaultModelId!;
      const mlcModelId = domainIdToMlcId(domainModelId);

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
            this.loadedModelId = domainModelId;
            this.worker?.removeEventListener("message", messageHandler);
            resolve(ok(undefined));
          } else if (msg.type === "error") {
            this.worker?.removeEventListener("message", messageHandler);
            resolve(
              err(new Error(`WebLLM initialization failed: ${msg.data}`)),
            );
          }
        };

        this.worker.addEventListener("message", messageHandler);
        this.worker.postMessage({
          type: "init",
          data: { modelId: mlcModelId },
        });
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
            modelId: this.loadedModelId!,
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
    return MODEL_METADATA_MAP[this.loadedModelId] ?? null;
  }

  async hasModelInCache(modelId: DomainModelId): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.worker) {
        resolve(false);
        return;
      }

      const mlcModelId = domainIdToMlcId(modelId);

      const timeoutId = setTimeout(() => {
        this.worker?.removeEventListener("message", handler);
        resolve(false);
      }, 10000);

      const handler = (e: MessageEvent) => {
        if (
          e.data?.type === "has-model-in-cache-result" &&
          e.data?.data?.modelId === mlcModelId
        ) {
          clearTimeout(timeoutId);
          this.worker!.removeEventListener("message", handler);
          resolve(e.data?.data?.isCached === true);
        }
      };
      this.worker.addEventListener("message", handler);
      this.worker.postMessage({
        type: "has-model-in-cache",
        data: { modelId: mlcModelId },
      });
    });
  }

  async deleteCachedModel(modelId: DomainModelId): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        resolve();
        return;
      }

      const mlcModelId = domainIdToMlcId(modelId);

      const timeoutId = setTimeout(() => {
        this.worker?.removeEventListener("message", handler);
        reject(new Error("Delete model cache timed out"));
      }, 10000);

      const handler = (e: MessageEvent) => {
        if (
          e.data?.type === "delete-cached-model-result" &&
          e.data?.modelId === mlcModelId
        ) {
          clearTimeout(timeoutId);
          this.worker!.removeEventListener("message", handler);
          if (e.data?.error) {
            reject(new Error(e.data.error));
          } else {
            resolve();
          }
        }
      };
      this.worker.addEventListener("message", handler);
      this.worker.postMessage({
        type: "delete-cached-model",
        data: { modelId: mlcModelId },
      });
    });
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
