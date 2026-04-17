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
          temperature: request.temperature ?? 0.7,
          maxTokens: request.maxTokens ?? 2048,
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

    const pendingChunks: string[] = [];
    let resolveNext: ((value: Result<string>) => void) | null = null;
    let streamDone = false;
    let streamError: Error | null = null;

    const timeoutId = setTimeout(() => {
      streamError = new Error("Streaming request timed out");
      if (resolveNext) {
        resolveNext(err(streamError));
        resolveNext = null;
      }
    }, 120000);

    const messageHandler = (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data;
      if (msg.type === "chunk") {
        if (resolveNext) {
          resolveNext(ok(msg.data as string));
          resolveNext = null;
        } else {
          pendingChunks.push(msg.data as string);
        }
      } else if (msg.type === "done") {
        streamDone = true;
        clearTimeout(timeoutId);
        if (resolveNext) {
          resolveNext(ok("[DONE]"));
          resolveNext = null;
        }
      } else if (msg.type === "error") {
        streamError = new Error(`Generation failed: ${msg.data}`);
        clearTimeout(timeoutId);
        if (resolveNext) {
          resolveNext(err(streamError));
          resolveNext = null;
        }
      }
    };

    try {
      this.worker.addEventListener("message", messageHandler);
      this.worker.postMessage({
        type: "generate",
        data: {
          messages: request.messages,
          temperature: request.temperature ?? 0.7,
          maxTokens: request.maxTokens ?? 2048,
          stream: true,
        },
      });

      while (!streamError) {
        if (streamDone) {
          while (pendingChunks.length > 0) {
            yield ok(pendingChunks.shift()!);
          }
          break;
        }
        const nextResult = await new Promise<Result<string>>((resolve) => {
          resolveNext = resolve;
        });
        if (!nextResult.success) break;
        if (nextResult.value === "[DONE]") break;
        yield nextResult;
      }

      if (streamError) {
        yield err(streamError);
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
      vendor: "Google",
      parameterSize: "2B",
      quantizeLevel: "q4f16",
      contextLength: 8192,
      vocabularySize: 256000,
      recommendedTemperature: 0.45,
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
