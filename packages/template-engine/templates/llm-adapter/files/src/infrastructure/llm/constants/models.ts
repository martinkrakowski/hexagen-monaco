export const MODELS = {
  xai: {
    reasoning: process.env.LLM_REASONING_MODEL ?? "grok-3-mini",
    fast: process.env.LLM_FAST_MODEL ?? "grok-3-fast",
    vision: process.env.LLM_VISION_MODEL ?? "grok-2-vision",
  },
  openai: {
    reasoning: process.env.OPENAI_REASONING_MODEL ?? "o3-mini",
    fast: process.env.OPENAI_FAST_MODEL ?? "gpt-4o-mini",
    vision: process.env.OPENAI_VISION_MODEL ?? "gpt-4o",
  },
  anthropic: {
    reasoning: process.env.ANTHROPIC_REASONING_MODEL ?? "claude-opus-4-7",
    fast: process.env.ANTHROPIC_FAST_MODEL ?? "claude-haiku-4-5-20251001",
    vision: process.env.ANTHROPIC_VISION_MODEL ?? "claude-opus-4-7",
  },
  ollama: {
    reasoning: process.env.OLLAMA_REASONING_MODEL ?? "llama3.3",
    fast: process.env.OLLAMA_FAST_MODEL ?? "llama3.2",
    vision: process.env.OLLAMA_VISION_MODEL ?? "llava",
  },
  "azure-openai": {
    reasoning:
      process.env.AZURE_OPENAI_REASONING_DEPLOYMENT ??
      process.env.AZURE_OPENAI_DEPLOYMENT ??
      "o3-mini",
    fast:
      process.env.AZURE_OPENAI_FAST_DEPLOYMENT ??
      process.env.AZURE_OPENAI_DEPLOYMENT ??
      "gpt-4o-mini",
    vision:
      process.env.AZURE_OPENAI_VISION_DEPLOYMENT ??
      process.env.AZURE_OPENAI_DEPLOYMENT ??
      "gpt-4o",
  },
} as const;

export type Provider = keyof typeof MODELS;
export type ModelTier = "reasoning" | "fast" | "vision";
