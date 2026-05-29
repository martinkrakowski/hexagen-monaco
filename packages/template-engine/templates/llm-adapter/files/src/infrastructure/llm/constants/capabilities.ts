export const REASONING_CAPABLE_MODELS = new Set([
  // xAI
  "grok-3-mini",
  "grok-3-mini-fast",
  // OpenAI
  "o3-mini",
  "o3",
  "o1-preview",
  "o1-mini",
  // Anthropic
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  // Ollama
  "llama3.3",
]);

export const VISION_CAPABLE_MODELS = new Set([
  // xAI
  "grok-2-vision",
  // OpenAI
  "gpt-4o",
  "gpt-4o-mini",
  // Anthropic
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
  // Ollama
  "llava",
  "llava-llama3",
]);

export function isReasoningModel(modelId: string): boolean {
  return REASONING_CAPABLE_MODELS.has(modelId);
}

export function isVisionModel(modelId: string): boolean {
  return VISION_CAPABLE_MODELS.has(modelId);
}
