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

export const DEFAULT_MODEL_ID = "gemma-2-2b-it-q4f16_1-MLC";

export const RECOMMENDED_TEMPERATURE = 0.7;

export const DEFAULT_TUNING_CONFIG = {
  temperature: 0.7,
  topP: undefined,
  topK: undefined,
  maxTokens: 768,
  frequencyPenalty: 0.3,
  presencePenalty: 0.0,
  repetitionPenalty: 1.4,
} as const;
