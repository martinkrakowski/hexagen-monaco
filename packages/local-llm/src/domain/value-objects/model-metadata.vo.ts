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
  [DomainModelId.QWEN_2_5_3B]: {
    modelId: DomainModelId.QWEN_2_5_3B,
    vendor: "Alibaba",
    parameterSize: "3B",
    quantizeLevel: "q4f16_1",
    contextLength: 32768,
    vocabularySize: 151936,
    recommendedTemperature: 0.6,
  },
  [DomainModelId.SMOLLM2_1_7B]: {
    modelId: DomainModelId.SMOLLM2_1_7B,
    vendor: "HuggingFace",
    parameterSize: "1.7B",
    quantizeLevel: "q4f32_1",
    contextLength: 8192,
    vocabularySize: 49152,
    recommendedTemperature: 0.6,
  },
  [DomainModelId.PHI3_MINI]: {
    modelId: DomainModelId.PHI3_MINI,
    vendor: "Microsoft",
    parameterSize: "3.8B",
    quantizeLevel: "q4f16_1",
    contextLength: 4096,
    vocabularySize: 32064,
    recommendedTemperature: 0.7,
  },
};

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
