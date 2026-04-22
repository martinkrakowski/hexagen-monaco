import { ok, err, type Result } from "@hexagen/shared";
import type { SendStructuredRequestPort } from "../../application/ports/in/index";
import type { ModelLifecyclePort } from "../../domain/ports/model-lifecycle.port";
import type { LocalLLMProviderPort } from "../../domain/ports/local-llm-provider.port";
import type {
  DomainModelId,
  LLMInitializeConfig,
  LLMProgress,
  LLMProgressCallback,
  ModelMetadata,
} from "../../domain/value-objects/index";
import type {
  LLMRequest,
  LLMResponse,
  SchemaValidationResult,
} from "../../domain/value-objects/index";
import type {
  LLMCompletionRequest,
  LLMCompletionResponse,
} from "../../domain/ports/index";
import type { StructuredOutputSchema } from "@hexagen/prompt-compiler";
import { MODEL_METADATA_MAP } from "../../domain/value-objects/model-metadata.vo";
import { z } from "zod";
import { validateStructuredOutput } from "@hexagen/prompt-compiler";

/**
 * MLC engine IDs inline — no separate mapper module, no new import chain.
 * Keeps the adapter self-contained and avoids any module-resolution edge cases
 * in the browser bundle.
 */
const MLC_IDS: Record<string, string> = {
  // Desktop High-End
  "qwen-coder-3b": "Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC",
  "llama-3.2-3b": "Llama-3.2-3B-Instruct-q4f16_1-MLC",
  "phi-3.5-mini": "Phi-3.5-mini-instruct-q4f16_1-MLC",
  // Desktop Compact
  "gemma-2-2b": "gemma-2-2b-it-q4f16_1-MLC",
  "qwen-coder-1.5b": "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC",
  // Ultra-Light
  "llama-3.2-1b": "Llama-3.2-1B-Instruct-q4f16_1-MLC",
  "qwen-coder-0.5b": "Qwen2.5-Coder-0.5B-Instruct-q4f16_1-MLC",
};

const DEFAULT_DOMAIN_MODEL_ID = "qwen-coder-3b";

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

export class WebLLMAdapter
  implements ModelLifecyclePort, SendStructuredRequestPort, LocalLLMProviderPort
{
  private loadedModelId: DomainModelId | null = null;
  private progressCallback: LLMProgressCallback | null = null;
  private worker: Worker | null = null;
  private config: WebLLMAdapterConfig;
  private _disposed = false;

  constructor(config: WebLLMAdapterConfig = {}) {
    this.config = {
      defaultModelId:
        config.defaultModelId ?? (DEFAULT_DOMAIN_MODEL_ID as DomainModelId),
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
      const domainModelId = config.modelId ?? this.config.defaultModelId!;
      const mlcModelId = MLC_IDS[domainModelId as string];
      if (!mlcModelId) {
        return err(new Error(`Unknown model ID: ${String(domainModelId)}`));
      }

      // Terminate any existing worker before creating a new one
      // to avoid zombie workers and GPU resource leaks
      if (this.worker) {
        this.worker.terminate();
        this.worker = null;
      }

      this._disposed = false;
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

  async sendRequest(request: LLMRequest): Promise<Result<LLMResponse>> {
    if (!this.worker || !this.loadedModelId) {
      return err(new Error("Engine not initialized. Call initialize() first."));
    }

    // Validate that the request has a schema for structured output
    if (!request.schema) {
      return err(
        new Error("LLMRequest must include a schema for structured output"),
      );
    }

    return new Promise((resolve) => {
      if (!this.worker) {
        resolve(err(new Error("Worker not available")));
        return;
      }

      const timeoutId = setTimeout(() => {
        resolve(err(new Error("Request timed out")));
      }, 120000);

      const messageHandler = (e: MessageEvent) => {
        const msg = e.data as WorkerMessage;
        if (msg.type === "result") {
          clearTimeout(timeoutId);
          this.worker?.removeEventListener("message", messageHandler);
          const rawResponse = msg.data as string;

          // Parse the raw response as JSON to validate against the schema
          let parsedData: unknown;
          try {
            parsedData = JSON.parse(rawResponse);
          } catch (parseError) {
            resolve(
              err(
                new Error(
                  `Failed to parse LLM response as JSON: ${String(parseError)}`,
                ),
              ),
            );
            return;
          }

          // Create a StructuredOutputSchema from the Zod schema in the request
          // We need to create a minimal StructuredOutputSchema for validation purposes
          const structuredOutputSchema: StructuredOutputSchema = {
            id: `temp-schema-${Date.now()}`,
            schema: request.schema as z.ZodTypeAny,
            version: 1,
            updatedAt: new Date().toISOString(),
          };

          // Validate against the provided schema using prompt-compiler's validation function
          const validationResult = validateStructuredOutput(
            structuredOutputSchema,
            parsedData,
          );

          if (validationResult.success) {
            // Validation successful - return the validated response
            const response: LLMResponse = {
              id: `webllm-${Date.now()}`,
              modelId: this.loadedModelId!,
              content: rawResponse,
              finishReason: "stop",
              usage: undefined, // WebLLM doesn't provide token usage by default
              timestamp: Date.now(),
            };
            resolve(ok(response));
          } else {
            // Validation failed - return error with details
            resolve(
              err(
                new Error(
                  `LLM response failed schema validation: ${validationResult.error.message}`,
                ),
              ),
            );
          }
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
          stream: request.stream ?? false,
        },
      });
    });
  }

  async *streamStructuredRequest(
    request: LLMRequest,
  ): AsyncGenerator<Result<string>> {
    if (!this.worker || !this.loadedModelId) {
      yield err(new Error("Engine not initialized. Call initialize() first."));
      return;
    }

    if (!request.schema) {
      yield err(
        new Error("LLMRequest must include a schema for structured output"),
      );
      return;
    }

    yield* this.streamComplete({
      modelId: request.modelId,
      messages: request.messages,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      topP: request.topP,
      stream: true,
    });
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

  // Keep the streamComplete method for backward compatibility but mark as deprecated
  async *streamComplete(request: {
    modelId: DomainModelId;
    messages: { role: "system" | "user" | "assistant"; content: string }[];
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    topK?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
    repetitionPenalty?: number;
    stream?: boolean;
  }): AsyncGenerator<Result<string>> {
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
    const meta = MODEL_METADATA_MAP[this.loadedModelId];
    if (!meta) return null;
    return meta;
  }

  async hasModelInCache(modelId: DomainModelId): Promise<boolean> {
    const mlcModelId = MLC_IDS[modelId as string];
    if (!mlcModelId) {
      return false;
    }

    const activeWorker = !this._disposed ? this.worker : null;
    if (activeWorker) {
      try {
        return await this.probeCacheViaWorker(activeWorker, mlcModelId);
      } catch {
        return false;
      }
    }

    const { createWorker } = this.config;
    if (createWorker) {
      const tempWorker = createWorker();
      try {
        return await this.probeCacheViaWorker(tempWorker, mlcModelId);
      } catch {
        return false;
      } finally {
        tempWorker.terminate();
      }
    }

    try {
      const { hasModelInCache } = await import("@mlc-ai/web-llm");
      return await hasModelInCache(mlcModelId);
    } catch {
      return false;
    }
  }

  private probeCacheViaWorker(
    worker: Worker,
    mlcModelId: string,
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        worker.removeEventListener("message", handler);
        reject(new Error("hasModelInCache timed out after 60s"));
      }, 60000);

      const handler = (e: MessageEvent) => {
        if (
          e.data?.type === "has-model-in-cache-result" &&
          e.data?.data?.modelId === mlcModelId
        ) {
          clearTimeout(timeoutId);
          worker.removeEventListener("message", handler);
          resolve(e.data?.data?.isCached === true);
        }
      };
      worker.addEventListener("message", handler);
      worker.postMessage({
        type: "has-model-in-cache",
        data: { modelId: mlcModelId },
      });
    });
  }

  async deleteCachedModel(modelId: DomainModelId): Promise<Result<void>> {
    const mlcModelId = MLC_IDS[modelId as string];
    if (!mlcModelId) {
      return err(new Error(`Unknown model ID: ${String(modelId)}`));
    }

    // Use a dedicated worker for deletion whenever possible. This keeps cache
    // cleanup isolated from the live inference worker and avoids deleting a
    // model while its engine is still loaded in the same worker.
    const { createWorker } = this.config;
    if (createWorker) {
      const tempWorker = createWorker();
      try {
        return await this.deleteViaWorker(tempWorker, mlcModelId);
      } finally {
        tempWorker.terminate();
      }
    }

    const activeWorker = !this._disposed ? this.worker : null;
    if (activeWorker) {
      return this.deleteViaWorker(activeWorker, mlcModelId);
    }

    // Last-resort fallback when no worker factory is configured (e.g. tests).
    // Guarded by a 60-second timeout so it can never hang indefinitely.
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        resolve(err(new Error("Delete model cache timed out after 60s")));
      }, 60000);

      import("@mlc-ai/web-llm")
        .then(({ deleteModelAllInfoInCache }) =>
          deleteModelAllInfoInCache(mlcModelId),
        )
        .then(() => {
          clearTimeout(timeoutId);
          resolve(ok(undefined));
        })
        .catch((error: unknown) => {
          clearTimeout(timeoutId);
          resolve(
            err(error instanceof Error ? error : new Error(String(error))),
          );
        });
    });
  }

  private deleteViaWorker(
    worker: Worker,
    mlcModelId: string,
  ): Promise<Result<void>> {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        worker.removeEventListener("message", handler);
        resolve(err(new Error("Delete model cache timed out after 60s")));
      }, 60000);

      const handler = (e: MessageEvent) => {
        if (
          e.data?.type === "delete-cached-model-result" &&
          e.data?.data?.modelId === mlcModelId
        ) {
          clearTimeout(timeoutId);
          worker.removeEventListener("message", handler);
          if (e.data?.data?.error) {
            resolve(err(new Error(e.data.data.error)));
          } else {
            resolve(ok(undefined));
          }
        }
      };
      worker.addEventListener("message", handler);
      worker.postMessage({
        type: "delete-cached-model",
        data: { modelId: mlcModelId },
      });
    });
  }

  dispose(): void {
    this._disposed = true;
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.loadedModelId = null;
    this.progressCallback = null;
  }
}
