import { isManifestCapableModel } from "@hexagen/local-llm";
import type { DomainModelId } from "@hexagen/local-llm";

export interface ManifestCapabilityAssessment {
  isCapable: boolean;
  reason: string;
}

export function assessModelCapability(
  modelId: DomainModelId | null,
  overrideEnabled: boolean,
): ManifestCapabilityAssessment {
  if (!modelId) {
    return {
      isCapable: true,
      reason: "No model loaded — capable by default",
    };
  }

  const nativelyCapable = isManifestCapableModel(modelId);

  if (nativelyCapable) {
    return {
      isCapable: true,
      reason: "Model natively supports manifest generation",
    };
  }

  if (overrideEnabled) {
    return {
      isCapable: true,
      reason: "Override enabled — user acknowledged model limitations",
    };
  }

  return {
    isCapable: false,
    reason: "Model lacks manifest generation capability",
  };
}