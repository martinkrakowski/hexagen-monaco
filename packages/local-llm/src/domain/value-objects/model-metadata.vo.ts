import { DomainModelId } from "./model-id.vo.js";

export interface ModelMetadata {
  modelId: DomainModelId;
  name: string;
  vendor: string;
  parameterSize: string;
  quantizeLevel: string;
  contextLength: number;
  vocabularySize: number;
  recommendedTemperature: number;
  /**
   * True for models that emit chain-of-thought ("thinking") by default
   * (e.g. the Qwen3 family). The WebLLM adapter must disable thinking at
   * generation time (`extra_body.enable_thinking: false`) for these models:
   * thinking tokens are billed against maxTokens caps and the emitted
   * `<think>` blocks break structured-output JSON parsing — the local
   * analog of baseline finding F1
   * (docs/planning/staged-generation-baseline-findings.md).
   *
   * Models whose thinking CANNOT be disabled (e.g. DeepSeek-R1-Distill)
   * are excluded from the catalog entirely for the same reason.
   */
  reasoningDefault?: boolean;
}

/**
 * LLMInitializeConfig: Configuration for initializing a model
 * Only includes modelId; temperature/maxTokens belong on completion requests
 */
export interface LLMInitializeConfig {
  modelId: DomainModelId;
}

/**
 * Single source of truth for model metadata
 * Keyed by DomainModelId to ensure type-safe model references
 */
export const MODEL_METADATA_MAP: Record<DomainModelId, ModelMetadata> = {
  // Desktop High-End
  [DomainModelId.QWEN3_8B]: {
    modelId: DomainModelId.QWEN3_8B,
    name: "Qwen3 8B",
    vendor: "Alibaba",
    parameterSize: "8B",
    quantizeLevel: "q4f16_1",
    contextLength: 32768,
    vocabularySize: 151936,
    recommendedTemperature: 0.7,
    reasoningDefault: true,
  },
  [DomainModelId.QWEN3_4B]: {
    modelId: DomainModelId.QWEN3_4B,
    name: "Qwen3 4B",
    vendor: "Alibaba",
    parameterSize: "4B",
    quantizeLevel: "q4f16_1",
    contextLength: 32768,
    vocabularySize: 151936,
    recommendedTemperature: 0.7,
    reasoningDefault: true,
  },
  [DomainModelId.QWEN_CODER_3B]: {
    modelId: DomainModelId.QWEN_CODER_3B,
    name: "Qwen Coder 3B",
    vendor: "Alibaba",
    parameterSize: "3B",
    quantizeLevel: "q4f16_1",
    contextLength: 32768,
    vocabularySize: 151936,
    recommendedTemperature: 0.6,
  },
  [DomainModelId.LLAMA_3_2_3B]: {
    modelId: DomainModelId.LLAMA_3_2_3B,
    name: "Llama 3.2 3B",
    vendor: "Meta",
    parameterSize: "3B",
    quantizeLevel: "q4f16_1",
    contextLength: 8192,
    vocabularySize: 128256,
    recommendedTemperature: 0.6,
  },
  // Desktop Compact
  [DomainModelId.QWEN3_1_7B]: {
    modelId: DomainModelId.QWEN3_1_7B,
    name: "Qwen3 1.7B",
    vendor: "Alibaba",
    parameterSize: "1.7B",
    quantizeLevel: "q4f16_1",
    contextLength: 32768,
    vocabularySize: 151936,
    recommendedTemperature: 0.7,
    reasoningDefault: true,
  },
  [DomainModelId.QWEN_CODER_1_5B]: {
    modelId: DomainModelId.QWEN_CODER_1_5B,
    name: "Qwen Coder 1.5B",
    vendor: "Alibaba",
    parameterSize: "1.5B",
    quantizeLevel: "q4f16_1",
    contextLength: 4096,
    vocabularySize: 151936,
    recommendedTemperature: 0.6,
  },
  // Ultra-Light
  [DomainModelId.QWEN3_0_6B]: {
    modelId: DomainModelId.QWEN3_0_6B,
    name: "Qwen3 0.6B",
    vendor: "Alibaba",
    parameterSize: "0.6B",
    quantizeLevel: "q4f16_1",
    contextLength: 32768,
    vocabularySize: 151936,
    recommendedTemperature: 0.7,
    reasoningDefault: true,
  },
  [DomainModelId.LLAMA_3_2_1B]: {
    modelId: DomainModelId.LLAMA_3_2_1B,
    name: "Llama 3.2 1B",
    vendor: "Meta",
    parameterSize: "1B",
    quantizeLevel: "q4f16_1",
    contextLength: 8192,
    vocabularySize: 128256,
    recommendedTemperature: 0.6,
  },
  [DomainModelId.QWEN_CODER_0_5B]: {
    modelId: DomainModelId.QWEN_CODER_0_5B,
    name: "Qwen Coder 0.5B",
    vendor: "Alibaba",
    parameterSize: "0.5B",
    quantizeLevel: "q4f16_1",
    contextLength: 2048,
    vocabularySize: 151936,
    recommendedTemperature: 0.6,
  },
};

export function getModelMetadata(modelId: DomainModelId): ModelMetadata {
  return MODEL_METADATA_MAP[modelId];
}

export const MANIFEST_CAPABLE_MODEL_IDS: ReadonlySet<DomainModelId> =
  new Set<DomainModelId>([
    DomainModelId.QWEN3_8B,
    DomainModelId.QWEN3_4B,
    DomainModelId.QWEN_CODER_3B,
    DomainModelId.LLAMA_3_2_3B,
  ]);

export function isManifestCapableModel(modelId: DomainModelId): boolean {
  return MANIFEST_CAPABLE_MODEL_IDS.has(modelId);
}

export const RECOMMENDED_TEMPERATURE = 0.6;

export const DEFAULT_TUNING_CONFIG = {
  temperature: 0.6,
  topP: 0.9,
  topK: undefined,
  maxTokens: 768,
  frequencyPenalty: 0.0,
  presencePenalty: 0.0,
  repetitionPenalty: 1.05,
} as const;
