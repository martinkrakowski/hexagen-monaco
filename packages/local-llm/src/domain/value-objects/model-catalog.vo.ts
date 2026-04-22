import type { Identifier } from "@hexagen/shared";
import type { DomainModelId } from "./model-id.vo.js";

/**
 * ModelCatalog value object — represents the catalog of available local models.
 * This is the domain-level equivalent of the UI-specific ModelDescriptor[]
 * found in apps/web/app/config/models.ts.
 */
export interface ModelCatalog {
  id: Identifier;
  models: ReadonlyArray<{
    modelId: DomainModelId;
    displayName: string;
    shortName: string;
    downloadSizeGB: number;
    vramRequiredMB: number;
    description: string;
    tier: "desktop-high" | "desktop-compact" | "ultra-light";
    backend: "webgpu";
    codingRating: 1 | 2 | 3 | 4 | 5;
    coreStrength: string;
  }>;
  version: number;
  updatedAt: string;
}

/**
 * Creates a new ModelCatalog with the given models
 */
export function createModelCatalog(
  models: ReadonlyArray<{
    modelId: DomainModelId;
    displayName: string;
    shortName: string;
    downloadSizeGB: number;
    vramRequiredMB: number;
    description: string;
    tier: "desktop-high" | "desktop-compact" | "ultra-light";
    backend: "webgpu";
    codingRating: 1 | 2 | 3 | 4 | 5;
    coreStrength: string;
  }>,
  version: number = 1,
): ModelCatalog {
  return {
    id: `model-catalog-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 9)}`,
    models,
    version,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Updates an existing ModelCatalog with new models and increments version
 */
export function updateModelCatalog(
  catalog: ModelCatalog,
  models: ReadonlyArray<{
    modelId: DomainModelId;
    displayName: string;
    shortName: string;
    downloadSizeGB: number;
    vramRequiredMB: number;
    description: string;
    tier: "desktop-high" | "desktop-compact" | "ultra-light";
    backend: "webgpu";
    codingRating: 1 | 2 | 3 | 4 | 5;
    coreStrength: string;
  }>,
): ModelCatalog {
  return {
    ...catalog,
    models,
    version: catalog.version + 1,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Finds a model descriptor by modelId in the catalog
 */
export function findModelById(
  catalog: ModelCatalog,
  modelId: DomainModelId,
):
  | {
      modelId: DomainModelId;
      displayName: string;
      shortName: string;
      downloadSizeGB: number;
      vramRequiredMB: number;
      description: string;
      tier: "desktop-high" | "desktop-compact" | "ultra-light";
      backend: "webgpu";
      codingRating: 1 | 2 | 3 | 4 | 5;
      coreStrength: string;
    }
  | undefined {
  return catalog.models.find((m) => m.modelId === modelId);
}
