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

export const DEFAULT_MODEL_ID = "Gemma-2B-it-q4f32f16-MLC";

export const RECOMMENDED_TEMPERATURE = 0.45;

export const DEFAULT_TUNING_CONFIG = {
  temperature: 0.45,
  topP: 0.9,
  topK: 64,
  maxTokens: 768,
  frequencyPenalty: 0.15,
  presencePenalty: 0.0,
} as const;
