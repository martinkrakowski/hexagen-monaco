import type {
  DomainModelId,
  LLMProgress,
} from "../../domain/value-objects/index";

export const MLC_IDS: Record<string, string> = {
  "qwen3-8b": "Qwen3-8B-q4f16_1-MLC",
  "qwen3-4b": "Qwen3-4B-q4f16_1-MLC",
  "qwen-coder-3b": "Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC",
  "llama-3.2-3b": "Llama-3.2-3B-Instruct-q4f16_1-MLC",
  "qwen3-1.7b": "Qwen3-1.7B-q4f16_1-MLC",
  "qwen-coder-1.5b": "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC",
  "qwen3-0.6b": "Qwen3-0.6B-q4f16_1-MLC",
  "llama-3.2-1b": "Llama-3.2-1B-Instruct-q4f16_1-MLC",
  "qwen-coder-0.5b": "Qwen2.5-Coder-0.5B-Instruct-q4f16_1-MLC",
};

export const DEFAULT_DOMAIN_MODEL_ID = "qwen-coder-3b";

export type WorkerMessage =
  | { type: "progress"; data: LLMProgress }
  | { type: "ready" }
  | { type: "result"; data: string }
  | { type: "chunk"; data: string }
  | { type: "done" }
  | { type: "error"; data: string };

export interface WebLLMAdapterConfig {
  defaultModelId?: DomainModelId;
  createWorker?: () => Worker;
}
