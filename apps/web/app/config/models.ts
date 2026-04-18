import { DomainModelId } from "@hexagen/local-llm";

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
  modelId: DomainModelId;
  displayName: string;
  shortName: string;
  downloadSizeGB: number;
  vramRequiredMB: number;
  description: string;
  // Hardware-aware recommendation fields
  tier: "desktop-high" | "desktop-compact" | "ultra-light";
  backend: "webgpu" | "wasm";
  codingRating: 1 | 2 | 3 | 4 | 5;
  coreStrength: string;
}

export const LOCAL_MODELS: ModelDescriptor[] = [
  // Desktop High-End
  {
    modelId: DomainModelId.QWEN_CODER_3B,
    displayName: "Qwen2.5-Coder-3B",
    shortName: "Qwen-Coder 3B",
    downloadSizeGB: 2.1,
    vramRequiredMB: 2600,
    description:
      "Current champion for 3B coding. Fast, highly accurate syntax generation. Excellent instruction following.",
    tier: "desktop-high",
    backend: "webgpu",
    codingRating: 5,
    coreStrength: "Best for architectural guidance & instruction-following",
  },
  {
    modelId: DomainModelId.LLAMA_3_2_3B,
    displayName: "Llama-3.2-3B",
    shortName: "Llama 3.2 3B",
    downloadSizeGB: 2.2,
    vramRequiredMB: 2700,
    description:
      "Superb generalist with strong coding and logic. Excellent instruction following.",
    tier: "desktop-high",
    backend: "webgpu",
    codingRating: 5,
    coreStrength: "Strong generalist & coding capabilities",
  },
  {
    modelId: DomainModelId.PHI_3_5_MINI,
    displayName: "Phi-3.5-Mini",
    shortName: "Phi-3.5 Mini",
    downloadSizeGB: 2.4,
    vramRequiredMB: 2800,
    description:
      "Microsoft's logic powerhouse. Punches above its weight in Python and algorithms.",
    tier: "desktop-high",
    backend: "webgpu",
    codingRating: 4,
    coreStrength: "Logic & algorithm reasoning",
  },
  // Desktop Compact
  {
    modelId: DomainModelId.GEMMA_2_2B,
    displayName: "Gemma-2-2B",
    shortName: "Gemma 2 2B",
    downloadSizeGB: 1.8,
    vramRequiredMB: 2200,
    description:
      "High-quality Google model. Great for rigid formatting and fill-in-the-middle tasks.",
    tier: "desktop-compact",
    backend: "webgpu",
    codingRating: 4,
    coreStrength: "Formatting & Fill-in-the-Middle",
  },
  {
    modelId: DomainModelId.QWEN_CODER_1_5B,
    displayName: "Qwen2.5-Coder-1.5B",
    shortName: "Qwen-Coder 1.5B",
    downloadSizeGB: 1.1,
    vramRequiredMB: 1500,
    description:
      "Best balance of extreme speed and reliable code completion under 1.5GB.",
    tier: "desktop-compact",
    backend: "webgpu",
    codingRating: 4,
    coreStrength: "Speed & code completion",
  },
  // Ultra-Light (Mobile-ready)
  {
    modelId: DomainModelId.LLAMA_3_2_1B,
    displayName: "Llama-3.2-1B",
    shortName: "Llama 3.2 1B",
    downloadSizeGB: 0.8,
    vramRequiredMB: 1200,
    description:
      "Blazingly fast for edge devices. Good for basic routing and simple script completion.",
    tier: "ultra-light",
    backend: "webgpu",
    codingRating: 3,
    coreStrength: "Edge device speed",
  },
  {
    modelId: DomainModelId.QWEN_CODER_0_5B,
    displayName: "Qwen2.5-Coder-0.5B",
    shortName: "Qwen-Coder 0.5B",
    downloadSizeGB: 0.4,
    vramRequiredMB: 800,
    description:
      "Extremely tiny. Loads instantly, but limited to basic boilerplate and simple regex.",
    tier: "ultra-light",
    backend: "webgpu",
    codingRating: 2,
    coreStrength: "Ultra-lightweight inference",
  },
];

export function getModelDescriptor(
  modelId: DomainModelId,
): ModelDescriptor | undefined {
  return LOCAL_MODELS.find((m) => m.modelId === modelId);
}

export function getModelShortName(modelId: DomainModelId): string {
  return getModelDescriptor(modelId)?.shortName ?? "Model";
}
