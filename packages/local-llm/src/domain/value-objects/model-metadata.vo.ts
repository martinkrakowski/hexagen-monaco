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

export const RECOMMENDED_TEMPERATURE = 0.6;

export const DEFAULT_TUNING_CONFIG = {
  temperature: 0.6,
  topP: 0.9,
  topK: undefined,
  maxTokens: 768,
  frequencyPenalty: 0.4,
  presencePenalty: 0.0,
} as const;
