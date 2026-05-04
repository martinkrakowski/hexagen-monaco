import type { DomainModelId } from "../../../domain/value-objects/model-id.vo";

export { DomainModelId };

export interface ModelVerificationPort {
  isModelVerified(modelId: DomainModelId, maxAgeHours?: number): boolean;
  updateModelCacheMetadata(
    modelId: DomainModelId,
    updates: { verifiedAt?: number; downloadCompleted?: boolean },
  ): void;
  clearModelCacheMetadata(modelId: DomainModelId): void;
}