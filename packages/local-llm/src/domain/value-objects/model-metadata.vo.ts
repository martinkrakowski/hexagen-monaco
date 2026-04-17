export interface ModelMetadata {
  modelId: string;
  vendor: string;
  parameterSize: string;
  quantizeLevel: string;
  contextLength: number;
  vocabularySize: number;
  recommendedTemperature: number;
  isLoaded: boolean;
}

export interface ModelConfig {
  modelId: string;
  temperature?: number;
  maxTokens?: number;
}

export const DEFAULT_MODEL_ID = "Qwen2.5-3B-Instruct-q4f16_1-MLC";

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
