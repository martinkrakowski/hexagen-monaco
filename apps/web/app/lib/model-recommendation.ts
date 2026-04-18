import type { DomainModelId } from "@hexagen/local-llm";
import type { HardwareProfile } from "@hexagen/local-llm";
import type { ModelDescriptor } from "@/config/models";

/**
 * Recommendation Result
 */
export interface RecommendationResult {
  modelId: DomainModelId;
  confidence: "high" | "medium" | "low";
  reason: string;
}

/**
 * Compatibility Issue if a model doesn't fit hardware
 */
export interface CompatibilityIssue {
  reason: string;
  severity: "warning" | "error";
}

/**
 * recommendModel: Pure function to select best model for hardware
 *
 * Algorithm:
 * 1. Filter models by available backend (currently only "webgpu")
 * 2. Filter by hardware fit (VRAM, if known)
 * 3. Sort by: codingRating DESC, then vramRequiredMB ASC
 * 4. Return top match or null if none fit
 *
 * Returns null if:
 * - No models available
 * - All models require unsupported backend
 * - All models exceed available VRAM (fallback to smallest)
 */
export function recommendModel(
  profile: HardwareProfile | null,
  models: ModelDescriptor[],
): RecommendationResult | null {
  if (!models || models.length === 0) return null;
  if (!profile) {
    // Fallback to first model if no hardware profile available
    const fallback = models[0];
    return {
      modelId: fallback.modelId,
      confidence: "low",
      reason: "Hardware profile unavailable. Using default.",
    };
  }

  // 1. Filter to available backends
  // Currently: only WebGPU is available
  const hasWebGPU = profile.gpu.supported;

  const candidates = models.filter((m) => {
    // Only include models with "webgpu" backend for now
    // ("wasm" models will be available in future phases)
    if (m.backend === "wasm") return false;
    return hasWebGPU;
  });

  // If no WebGPU models available, return null (no fallback to WASM in MVP)
  if (candidates.length === 0) {
    return null;
  }

  // 2. Try to filter by VRAM fit
  // If maxBufferMB is unknown, skip VRAM filtering
  let vramConstrainedCandidates = candidates;
  if (profile.gpu.maxBufferMB !== null) {
    const fittingByVram = candidates.filter(
      (m) => m.vramRequiredMB <= profile.gpu.maxBufferMB!,
    );

    // If some models fit, use only those
    // If none fit, keep all candidates (best effort)
    if (fittingByVram.length > 0) {
      vramConstrainedCandidates = fittingByVram;
    }
  }

  // 3. Sort by: codingRating DESC, then vramRequiredMB ASC
  const sorted = [...vramConstrainedCandidates].sort((a, b) => {
    if (b.codingRating !== a.codingRating) {
      return b.codingRating - a.codingRating;
    }
    return a.vramRequiredMB - b.vramRequiredMB;
  });

  const recommended = sorted[0];
  if (!recommended) return null;

  // Determine confidence
  let confidence: "high" | "medium" | "low" = "high";
  let reason = `Best fit for your system. Rating: ${recommended.codingRating}⭐`;

  // Lower confidence if VRAM is tight
  if (
    profile.gpu.maxBufferMB !== null &&
    recommended.vramRequiredMB > profile.gpu.maxBufferMB * 0.8
  ) {
    confidence = "medium";
    reason += " (VRAM is tight)";
  }

  // Lower confidence if maxBufferMB is unknown
  if (profile.gpu.maxBufferMB === null) {
    confidence = "medium";
    reason = `Recommended based on rating (hardware details unavailable).`;
  }

  return {
    modelId: recommended.modelId,
    confidence,
    reason,
  };
}

/**
 * checkCompatibility: Detect issues between model and hardware
 *
 * Returns null if compatible, or a CompatibilityIssue if not
 */
export function checkCompatibility(
  modelDescriptor: ModelDescriptor,
  profile: HardwareProfile | null,
): CompatibilityIssue | null {
  if (!profile) {
    return null; // Can't validate without profile
  }

  // Check backend availability
  if (modelDescriptor.backend === "webgpu" && !profile.gpu.supported) {
    return {
      reason: "This model requires GPU acceleration. WebGPU is not available.",
      severity: "error",
    };
  }

  // Check VRAM
  if (
    profile.gpu.supported &&
    profile.gpu.maxBufferMB !== null &&
    modelDescriptor.vramRequiredMB > profile.gpu.maxBufferMB
  ) {
    return {
      reason: `This model may exceed your GPU memory. Required: ${modelDescriptor.vramRequiredMB} MB, Available: ${profile.gpu.maxBufferMB} MB.`,
      severity: "warning",
    };
  }

  return null;
}
