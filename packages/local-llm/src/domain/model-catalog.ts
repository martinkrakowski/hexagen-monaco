import { DomainModelId } from "./value-objects/model-id.vo.js";

/**
 * Local model registry for the web app.
 *
 * Carries UI-specific display data and resource estimates. Does NOT
 * duplicate ModelMetadata fields (vendor, parameterSize, quantizeLevel,
 * contextLength) — those come from getLoadedModel() after the model
 * is loaded by WebLLM.
 *
 * Provenance: sizes are approximate, sourced from HuggingFace MLC
 * model artifacts and WebLLM's vram_required_MB figures. Values
 * drift as model weights are updated upstream.
 */

/**
 * Hardware-aware recommendation category. Used by
 * useHardwareDetection to surface suitable models for the user's
 * device.
 */
export type ModelTier = "desktop-high" | "desktop-compact" | "ultra-light";

/**
 * Subjective quality rating for code-generation tasks (1 = minimal, 5 = strongest).
 */
export type CodingRating = 1 | 2 | 3 | 4 | 5;

export interface ModelDescriptor {
  modelId: DomainModelId;
  displayName: string;
  shortName: string;
  downloadSizeGB: number;
  vramRequiredMB: number;
  description: string;
  tier: ModelTier;
  /**
   * All current models use WebGPU. This field is retained as a
   * literal to document the assumption at every call site; revisit
   * if/when a WASM-fallback model is added.
   */
  backend: "webgpu";
  codingRating: CodingRating;
  coreStrength: string;
}

export const LOCAL_MODELS: readonly ModelDescriptor[] = [
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

/** Lookup a descriptor by model id. */
export function getModelDescriptor(
  modelId: DomainModelId,
): ModelDescriptor | undefined {
  return LOCAL_MODELS.find((m) => m.modelId === modelId);
}

/** Compact display name for a model, with a "Model" fallback. */
export function getModelShortName(modelId: DomainModelId): string {
  return getModelDescriptor(modelId)?.shortName ?? "Model";
}

/** All models in a given tier. */
export function getModelsByTier(tier: ModelTier): readonly ModelDescriptor[] {
  return LOCAL_MODELS.filter((m) => m.tier === tier);
}
