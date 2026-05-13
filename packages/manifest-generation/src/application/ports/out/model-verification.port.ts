import type { DomainModelId } from "@hexagen/local-llm/client";

export interface ModelVerificationPort {
  isModelVerified(modelId: DomainModelId, maxAgeHours?: number): boolean;
  updateModelCacheMetadata(
    modelId: DomainModelId,
    updates: { verifiedAt?: number; downloadCompleted?: boolean },
  ): void;
  clearModelCacheMetadata(modelId: DomainModelId): void;
}
