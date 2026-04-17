/**
 * Local model registry for the web app.
 *
 * Sizes are approximate — sourced from HuggingFace MLC model artifacts and
 * WebLLM's vram_required_MB figures. Will drift as model weights are updated.
 * In Phase 2, consider fetching actual sizes from the WebLLM model config
 * at runtime via the model list API.
 *
 * Does NOT duplicate ModelMetadata fields (vendor, parameterSize, quantizeLevel,
 * contextLength). Those come from getLoadedModel() after the model is loaded.
 * This registry only carries UI-specific display data and resource estimates.
 */

export interface ModelDescriptor {
  id: string;
  displayName: string;
  shortName: string;
  downloadSizeGB: number;
  vramRequiredMB: number;
  description: string;
}

export const LOCAL_MODELS: ModelDescriptor[] = [
  {
    id: "Qwen2.5-3B-Instruct-q4f16_1-MLC",
    displayName: "Qwen 2.5 3B",
    shortName: "Qwen 2.5 3B",
    downloadSizeGB: 1.74,
    vramRequiredMB: 2505,
    description:
      "Best for architectural guidance. Excellent instruction-following and reasoning across a 32K context. Recommended default.",
  },
  {
    id: "SmolLM2-1.7B-Instruct-q4f32_1-MLC",
    displayName: "SmolLM2 1.7B",
    shortName: "SmolLM2 1.7B",
    downloadSizeGB: 1.0,
    vramRequiredMB: 2692,
    description:
      "Compact and fast. Good for quick guidance on lower-VRAM systems. Slightly more VRAM than Qwen due to q4f32 precision.",
  },
  {
    id: "Phi-3-mini-4k-instruct-q4f16_1-MLC",
    displayName: "Phi 3 Mini",
    shortName: "Phi 3 Mini",
    downloadSizeGB: 1.5,
    vramRequiredMB: 3672,
    description:
      "Lightweight Microsoft model with 4K context. Known to have token repetition issues in WebLLM — use as fallback only.",
  },
];

export function getModelDescriptor(
  modelId: string,
): ModelDescriptor | undefined {
  return LOCAL_MODELS.find((m) => m.id === modelId);
}

export function getModelShortName(modelId: string): string {
  return getModelDescriptor(modelId)?.shortName ?? modelId.split("-")[0];
}
