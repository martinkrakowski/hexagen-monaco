import { ok, err, type Result } from "@hexagen/shared";
import type { WorkerMessage } from "./webllm-constants.js";

export interface StreamingRequest {
  modelId?: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  repetitionPenalty?: number;
  stream?: boolean;
}

export async function* createStreamingGenerator(
  worker: Worker,
  request: StreamingRequest,
  timeoutMs: number = 120000,
): AsyncGenerator<Result<string>> {
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
  }, timeoutMs);

  try {
    worker.addEventListener("message", messageHandler);
    worker.postMessage({
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
    worker.removeEventListener("message", messageHandler);
  }
}
