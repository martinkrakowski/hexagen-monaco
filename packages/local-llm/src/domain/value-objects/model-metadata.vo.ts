import { DomainModelId } from "./model-id.vo.js";

export interface ModelMetadata {
  modelId: DomainModelId;
  vendor: string;
  parameterSize: string;
  quantizeLevel: string;
  contextLength: number;
  vocabularySize: number;
  recommendedTemperature: number;
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
  [DomainModelId.QWEN_CODER_3B]: {
    modelId: DomainModelId.QWEN_CODER_3B,
    vendor: "Alibaba",
    parameterSize: "3B",
    quantizeLevel: "q4f16_1",
    contextLength: 32768,
    vocabularySize: 151936,
    recommendedTemperature: 0.6,
  },
  [DomainModelId.LLAMA_3_2_3B]: {
    modelId: DomainModelId.LLAMA_3_2_3B,
    vendor: "Meta",
    parameterSize: "3B",
    quantizeLevel: "q4f16_1",
    contextLength: 8192,
    vocabularySize: 128256,
    recommendedTemperature: 0.6,
  },
  [DomainModelId.PHI_3_5_MINI]: {
    modelId: DomainModelId.PHI_3_5_MINI,
    vendor: "Microsoft",
    parameterSize: "3.8B",
    quantizeLevel: "q4f16_1",
    contextLength: 4096,
    vocabularySize: 32064,
    recommendedTemperature: 0.7,
  },
  // Desktop Compact
  [DomainModelId.GEMMA_2_2B]: {
    modelId: DomainModelId.GEMMA_2_2B,
    vendor: "Google",
    parameterSize: "2B",
    quantizeLevel: "q4f16_1",
    contextLength: 8192,
    vocabularySize: 256000,
    recommendedTemperature: 0.6,
  },
  [DomainModelId.QWEN_CODER_1_5B]: {
    modelId: DomainModelId.QWEN_CODER_1_5B,
    vendor: "Alibaba",
    parameterSize: "1.5B",
    quantizeLevel: "q4f16_1",
    contextLength: 4096,
    vocabularySize: 151936,
    recommendedTemperature: 0.6,
  },
  // Ultra-Light
  [DomainModelId.LLAMA_3_2_1B]: {
    modelId: DomainModelId.LLAMA_3_2_1B,
    vendor: "Meta",
    parameterSize: "1B",
    quantizeLevel: "q4f16_1",
    contextLength: 8192,
    vocabularySize: 128256,
    recommendedTemperature: 0.6,
  },
  [DomainModelId.QWEN_CODER_0_5B]: {
    modelId: DomainModelId.QWEN_CODER_0_5B,
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
