import type { Result } from "@hexagen/shared";
import type {
  DomainModelId,
  LLMInitializeConfig,
  LLMProgressCallback,
  ModelMetadata,
} from "../value-objects/index.js";

export interface ModelLifecyclePort {
  initialize(
    config: LLMInitializeConfig,
    onProgress: LLMProgressCallback,
  ): Promise<Result<void>>;
  getLoadedModel(): ModelMetadata | null;
  hasModelInCache(modelId: DomainModelId): Promise<boolean>;
  deleteCachedModel(modelId: DomainModelId): Promise<Result<void>>;
  dispose(): void;
}

export function isModelLifecyclePort(
  port: unknown,
): port is ModelLifecyclePort {
  if (port === null || typeof port !== "object") return false;
  const p = port as Record<string, unknown>;
  return (
    typeof p.initialize === "function" &&
    typeof p.getLoadedModel === "function" &&
    typeof p.hasModelInCache === "function" &&
    typeof p.deleteCachedModel === "function" &&
    typeof p.dispose === "function"
  );
}
