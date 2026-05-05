import type { MLCEngineInterface, InitProgressReport } from "@mlc-ai/web-llm";
import type { ChatCompletionMessageParam } from "@mlc-ai/web-llm/lib/openai_api_protocols";

interface InitData {
  modelId: string;
}

interface GenerateData {
  messages: ChatCompletionMessageParam[];
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  repetitionPenalty?: number;
}

interface CacheData {
  modelId: string;
}

type WorkerMessage =
  | { type: "init"; data: InitData }
  | { type: "generate"; data: GenerateData }
  | { type: "has-model-in-cache"; data: CacheData }
  | { type: "delete-cached-model"; data: CacheData };

let engine: MLCEngineInterface | null = null;

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as WorkerMessage;
  const { type } = msg;

  if (type === "init") {
    const { data } = msg;
    try {
      const { CreateMLCEngine } = await import("@mlc-ai/web-llm");

      engine = await CreateMLCEngine(data.modelId, {
        initProgressCallback: (mlcProgress: InitProgressReport) => {
          const text = (mlcProgress.text || "").toLowerCase();
          let phase = "loading-model";
          if (text.includes("compil") || text.includes("shader")) {
            phase = "compiling-shader";
          } else if (text.includes("init") && !text.includes("loading")) {
            phase = "initializing-engine";
          }
          self.postMessage({
            type: "progress",
            data: {
              progress: mlcProgress.progress ?? 0,
              text: mlcProgress.text ?? "",
              phase,
            },
          });
        },
      });

      self.postMessage({ type: "ready" });
    } catch (err: unknown) {
      self.postMessage({
        type: "error",
        data: err instanceof Error ? err.message : String(err),
      });
    }
  } else if (type === "generate") {
    const { data } = msg;
    if (!engine) {
      self.postMessage({ type: "error", data: "Engine not initialized" });
      return;
    }

    try {
      const messages = data.messages;
      const stream = data.stream ?? false;

      if (stream) {
        const streamResult = await engine.chat.completions.create({
          messages,
          temperature: data.temperature ?? 0.6,
          max_tokens: data.maxTokens ?? 768,
          top_p: data.topP,
          frequency_penalty: data.frequencyPenalty,
          presence_penalty: data.presencePenalty,
          stream: true as const,
          ...({
            top_k: data.topK,
            repetition_penalty: data.repetitionPenalty,
          } as Record<string, unknown>),
        });
        for await (const chunk of streamResult as AsyncIterable<
          import("@mlc-ai/web-llm/lib/openai_api_protocols").ChatCompletionChunk
        >) {
          const content = chunk.choices[0]?.delta?.content;
          if (content) {
            self.postMessage({ type: "chunk", data: content });
          }
        }
        self.postMessage({ type: "done", data: "" });
      } else {
        const result = await engine.chat.completions.create({
          messages,
          temperature: data.temperature ?? 0.6,
          max_tokens: data.maxTokens ?? 768,
          top_p: data.topP,
          frequency_penalty: data.frequencyPenalty,
          presence_penalty: data.presencePenalty,
          stream: false as const,
          ...({
            top_k: data.topK,
            repetition_penalty: data.repetitionPenalty,
          } as Record<string, unknown>),
        });
        const completion =
          result as import("@mlc-ai/web-llm/lib/openai_api_protocols").ChatCompletion;
        self.postMessage({
          type: "result",
          data: completion.choices[0]?.message?.content || "",
        });
      }
    } catch (err: unknown) {
      self.postMessage({
        type: "error",
        data: err instanceof Error ? err.message : String(err),
      });
    }
  } else if (type === "has-model-in-cache") {
    const { data } = msg;
    try {
      const { hasModelInCache } = await import("@mlc-ai/web-llm");
      const isCached = await hasModelInCache(data.modelId);
      self.postMessage({
        type: "has-model-in-cache-result",
        data: { modelId: data.modelId, isCached },
      });
    } catch {
      self.postMessage({
        type: "has-model-in-cache-result",
        data: { modelId: data.modelId, isCached: false },
      });
    }
  } else if (type === "delete-cached-model") {
    const { data } = msg;
    try {
      const { deleteModelAllInfoInCache } = await import("@mlc-ai/web-llm");
      await deleteModelAllInfoInCache(data.modelId);
      self.postMessage({
        type: "delete-cached-model-result",
        data: { modelId: data.modelId },
      });
    } catch (err: unknown) {
      self.postMessage({
        type: "delete-cached-model-result",
        data: {
          modelId: data.modelId,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }
};
