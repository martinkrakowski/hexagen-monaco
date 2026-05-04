import { ok, err, type Result } from "@hexagen/shared";
import type { SendStructuredRequestPort } from "../../application/ports/in/index";
import type { ModelLifecyclePort } from "../../domain/ports/model-lifecycle.port";
import type { LocalLLMProviderPort } from "../../domain/ports/local-llm-provider.port";
import type {
  DomainModelId,
  LLMInitializeConfig,
  LLMProgressCallback,
  ModelMetadata,
} from "../../domain/value-objects/index";
import type { LLMRequest, LLMResponse } from "../../domain/value-objects/index";
import type {
  LLMCompletionRequest,
  LLMCompletionResponse,
} from "../../domain/ports/index";
import type { StructuredOutputSchema } from "@hexagen/prompt-compiler";
import { MODEL_METADATA_MAP } from "../../domain/value-objects/model-metadata.vo";
import { z } from "zod";
import { validateStructuredOutput } from "@hexagen/prompt-compiler";
import {
  MLC_IDS,
  DEFAULT_DOMAIN_MODEL_ID,
  type WorkerMessage,
  type WebLLMAdapterConfig,
} from "./webllm-constants.js";
import { probeCacheViaWorker, deleteViaWorker } from "./webllm-cache-ops.js";
import { createStreamingGenerator } from "./webllm-streaming.js";

export type { WebLLMAdapterConfig } from "./webllm-constants.js";

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

          const structuredOutputSchema: StructuredOutputSchema = {
            id: `temp-schema-${Date.now()}`,
            schema: request.schema as z.ZodTypeAny,
            version: 1,
            updatedAt: new Date().toISOString(),
          };

          const validationResult = validateStructuredOutput(
            structuredOutputSchema,
            parsedData,
          );

          if (validationResult.success) {
            const response: LLMResponse = {
              id: `webllm-${Date.now()}`,
              modelId: this.loadedModelId!,
              content: rawResponse,
              finishReason: "stop",
              usage: undefined,
              timestamp: Date.now(),
            };
            resolve(ok(response));
          } else {
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

    yield* createStreamingGenerator(this.worker, request);
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
        return await probeCacheViaWorker(activeWorker, mlcModelId);
      } catch {
        return false;
      }
    }

    const { createWorker } = this.config;
    if (createWorker) {
      const tempWorker = createWorker();
      try {
        return await probeCacheViaWorker(tempWorker, mlcModelId);
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

  async deleteCachedModel(modelId: DomainModelId): Promise<Result<void>> {
    const mlcModelId = MLC_IDS[modelId as string];
    if (!mlcModelId) {
      return err(new Error(`Unknown model ID: ${String(modelId)}`));
    }

    const { createWorker } = this.config;
    if (createWorker) {
      const tempWorker = createWorker();
      try {
        return await deleteViaWorker(tempWorker, mlcModelId);
      } finally {
        tempWorker.terminate();
      }
    }

    const activeWorker = !this._disposed ? this.worker : null;
    if (activeWorker) {
      return deleteViaWorker(activeWorker, mlcModelId);
    }

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
