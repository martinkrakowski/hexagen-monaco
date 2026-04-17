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

export const DEFAULT_MODEL_ID = "Phi-3-mini-4k-instruct-q4f16_1-MLC";

export const RECOMMENDED_TEMPERATURE = 0.2;
