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

interface WebLLMEngine {
  chat: {
    completions: {
      create(options: {
        messages: Array<{ role: string; content: string }>;
        temperature?: number;
        max_tokens?: number;
        stream?: boolean;
      }): AsyncIterable<{
        choices: Array<{
          delta: { role: string; content: string };
          finish_reason: string | null;
        }>;
      }>;
    };
  };
}

export interface WebLLMAdapterConfig {
  defaultModelId?: string;
  webllmCdnUrl?: string;
}

type WorkerMessage =
  | { type: "progress"; data: LLMProgress }
  | { type: "ready" }
  | { type: "result"; data: string }
  | { type: "chunk"; data: string }
  | { type: "done" }
  | { type: "error"; data: string };

export class WebLLMAdapter implements LocalLLMProviderPort {
  private engine: WebLLMEngine | null = null;
  private loadedModelId: string | null = null;
  private progressCallback: LLMProgressCallback | null = null;
  private workerUrl: string | null = null;
  private worker: Worker | null = null;
  private config: WebLLMAdapterConfig;

  constructor(config: WebLLMAdapterConfig = {}) {
    this.config = {
      defaultModelId: config.defaultModelId ?? DEFAULT_MODEL_ID,
      webllmCdnUrl:
        config.webllmCdnUrl ??
        "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.0/dist/webllm.js",
    };
  }

  async initialize(
    config: ModelConfig,
    onProgress: LLMProgressCallback,
  ): Promise<Result<void>> {
    try {
      this.progressCallback = onProgress;
      const modelId = config.modelId || this.config.defaultModelId!;

      const progressHandler = (progress: LLMProgress): void => {
        if (this.progressCallback) {
          this.progressCallback(progress);
        }
      };

      const webllmUrl = this.config.webllmCdnUrl!;

      const workerScript = `
        let engine = null;
        self.onmessage = async function(e) {
          const { type, data } = e.data;
          if (type === 'init') {
            try {
              const webllmUrl = data.webllmUrl || 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.0/dist/webllm.js';
              const mlc = await import(webllmUrl);
              const CreateMLCEngine = mlc.CreateMLCEngine ?? mlc.default?.CreateMLCEngine;
              if (!CreateMLCEngine) {
                throw new Error('WebLLM CreateMLCEngine not found in module exports');
              }
              engine = await CreateMLCEngine(
                data.modelId,
                {
                  initProgressCallback: (mlcProgress) => {
                    const text = (mlcProgress.text || '').toLowerCase();
                    let phase = 'loading-model';
                    if (text.includes('compil') || text.includes('shader')) {
                      phase = 'compiling-shader';
                    } else if (text.includes('init') && !text.includes('loading')) {
                      phase = 'initializing-engine';
                    }
                    self.postMessage({
                      type: 'progress',
                      data: {
                        progress: mlcProgress.progress ?? 0,
                        text: mlcProgress.text ?? '',
                        phase,
                      }
                    });
                  }
                }
              );
              self.postMessage({ type: 'ready' });
            } catch (err) {
              self.postMessage({ type: 'error', data: err.message });
            }
          } else if (type === 'generate') {
            try {
              const messages = data.messages.map(m => ({ role: m.role, content: m.content }));
              const stream = data.stream ?? false;
              if (stream) {
                const streamResult = await engine.chat.completions.create({
                  messages,
                  temperature: data.temperature ?? 0.7,
                  max_tokens: data.maxTokens ?? 2048,
                  stream: true
                });
                for await (const chunk of streamResult) {
                  const content = chunk.choices[0]?.delta?.content;
                  if (content) {
                    self.postMessage({ type: 'chunk', data: content });
                  }
                }
                self.postMessage({ type: 'done', data: '' });
              } else {
                const result = await engine.chat.completions.create({
                  messages,
                  temperature: data.temperature ?? 0.7,
                  max_tokens: data.maxTokens ?? 2048,
                  stream: false
                });
                self.postMessage({ type: 'result', data: result.choices[0]?.message?.content || '' });
              }
            } catch (err) {
              self.postMessage({ type: 'error', data: err.message });
            }
          }
        };
      `;

      const blob = new Blob([workerScript], { type: "application/javascript" });
      this.workerUrl = URL.createObjectURL(blob);
      this.worker = new Worker(this.workerUrl, { type: "module" });

      return new Promise((resolve) => {
        if (!this.worker) {
          resolve(err(new Error("Failed to create worker")));
          return;
        }

        const messageHandler = (e: MessageEvent) => {
          const { type, data } = e.data;
          if (type === "progress") {
            progressHandler(data as LLMProgress);
          } else if (type === "ready") {
            this.loadedModelId = modelId;
            resolve(ok(undefined));
          } else if (type === "error") {
            resolve(err(new Error(`WebLLM initialization failed: ${data}`)));
          }
        };

        this.worker.addEventListener("message", messageHandler);

        this.worker.postMessage({
          type: "init",
          data: { modelId, webllmUrl },
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
        const { type, data } = e.data;
        if (type === "result") {
          clearTimeout(timeoutId);
          this.worker?.removeEventListener("message", messageHandler);
          const response: LLMCompletionResponse = {
            id: `webllm-${Date.now()}`,
            model: this.loadedModelId!,
            choices: [
              {
                message: {
                  role: "assistant",
                  content: data as string,
                },
                finishReason: "stop",
              },
            ],
          };
          resolve(ok(response));
        } else if (type === "error") {
          clearTimeout(timeoutId);
          this.worker?.removeEventListener("message", messageHandler);
          resolve(err(new Error(`Generation failed: ${data}`)));
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
      vendor: "MLC AI",
      parameterSize: "3.8B",
      quantizeLevel: "q4f16_1",
      contextLength: 4096,
      vocabularySize: 32064,
      recommendedTemperature: 0.2,
      isLoaded: true,
    };
  }

  dispose(): void {
    if (this.workerUrl) {
      URL.revokeObjectURL(this.workerUrl);
      this.workerUrl = null;
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.engine = null;
    this.loadedModelId = null;
    this.progressCallback = null;
  }
}
