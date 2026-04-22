import type { HardwareProfile } from "../../domain/value-objects/hardware-profile.vo.js";
import type { ModelDescriptor } from "../../domain/model-catalog.js";
import type { DomainModelId } from "../../domain/value-objects/model-id.vo.js";

/**
 * RecommendationResult: output of hardware-aware model recommendation.
 * Pure value object — no behaviour.
 */
export interface RecommendationResult {
  readonly modelId: DomainModelId;
  readonly reason: string;
  readonly confidence: "high" | "medium" | "low";
}

/**
 * CompatibilityIssue: the most significant problem for running a model on
 * given hardware. `severity: "error"` means the model cannot run at all;
 * `"warning"` means it may run slowly or have degraded quality.
 */
export interface CompatibilityIssue {
  readonly severity: "warning" | "error";
  readonly reason: string;
}

/**
 * Effective VRAM budget for a given hardware profile.
 * Prefers reported GPU buffer capacity, falls back to half of system RAM,
 * and finally to a conservative default.
 */
function estimateVramBudgetMB(hardware: HardwareProfile): number {
  if (hardware.gpu.maxBufferMB !== null && hardware.gpu.maxBufferMB > 0) {
    return hardware.gpu.maxBufferMB;
  }
  if (hardware.ramMB !== null && hardware.ramMB > 0) {
    return Math.floor(hardware.ramMB / 2);
  }
  return 2000;
}

/**
 * recommendModel: Pure function to select best model for hardware.
 *
 * Selection strategy:
 *   1. If WebGPU is unavailable, fall back to smallest model as best-effort.
 *   2. Compute an effective VRAM budget.
 *   3. Filter to models that fit within the budget.
 *   4. Prefer highest `codingRating`, breaking ties by smaller `vramRequiredMB`.
 *
 * Returns `null` only when the input model list is empty.
 */
export function recommendModel(
  hardware: HardwareProfile,
  models: readonly ModelDescriptor[],
): RecommendationResult | null {
  if (models.length === 0) return null;

  if (!hardware.gpu.supported) {
    const smallest = [...models].sort(
      (a, b) => a.vramRequiredMB - b.vramRequiredMB,
    )[0];
    return {
      modelId: smallest.modelId,
      reason:
        "WebGPU is unavailable on this device. Falling back to the smallest model as a best-effort suggestion.",
      confidence: "low",
    };
  }

  const vramBudgetMB = estimateVramBudgetMB(hardware);
  const suitable = models.filter((m) => m.vramRequiredMB <= vramBudgetMB);

  if (suitable.length === 0) {
    const smallest = [...models].sort(
      (a, b) => a.vramRequiredMB - b.vramRequiredMB,
    )[0];
    return {
      modelId: smallest.modelId,
      reason: `No model fits the estimated ${vramBudgetMB}MB VRAM budget. Using the smallest model as a fallback.`,
      confidence: "low",
    };
  }

  const sorted = [...suitable].sort((a, b) => {
    if (b.codingRating !== a.codingRating) {
      return b.codingRating - a.codingRating;
    }
    return a.vramRequiredMB - b.vramRequiredMB;
  });

  const best = sorted[0];
  const confidence: RecommendationResult["confidence"] =
    hardware.deviceClass === "mobile" ? "medium" : "high";

  return {
    modelId: best.modelId,
    reason: `Recommended based on an estimated ${vramBudgetMB}MB VRAM budget and coding rating ${best.codingRating}/5.`,
    confidence,
  };
}

/**
 * checkCompatibility: Detect the single most significant issue between a
 * specific model and hardware.
 *
 * Returns `null` when the model is fully compatible, or when the hardware
 * profile is unknown (`null`). Returns the highest-severity issue
 * otherwise — `"error"` outranks `"warning"`.
 */
export function checkCompatibility(
  descriptor: ModelDescriptor,
  hardware: HardwareProfile | null,
): CompatibilityIssue | null {
  if (!hardware) return null;

  // Blocking errors: model physically cannot run
  if (descriptor.backend === "webgpu" && !hardware.gpu.supported) {
    return {
      severity: "error",
      reason:
        "Model requires WebGPU, which is not supported on this browser or device.",
    };
  }

  if (
    hardware.gpu.maxBufferMB !== null &&
    hardware.gpu.maxBufferMB < descriptor.vramRequiredMB
  ) {
    return {
      severity: "error",
      reason: `Model requires ${descriptor.vramRequiredMB}MB VRAM but only ${hardware.gpu.maxBufferMB}MB is available.`,
    };
  }

  // Warnings: model may run but with degraded experience
  if (hardware.ramMB !== null) {
    const recommendedRamMB = descriptor.vramRequiredMB * 2;
    if (hardware.ramMB < recommendedRamMB) {
      return {
        severity: "warning",
        reason: `Low system RAM (${hardware.ramMB}MB available, ${recommendedRamMB}MB recommended). Model may run slowly or fail to load.`,
      };
    }
  }

  if (hardware.deviceClass === "mobile" && descriptor.tier !== "ultra-light") {
    return {
      severity: "warning",
      reason: "Non-ultra-light models may perform poorly on mobile devices.",
    };
  }

  return null;
}
