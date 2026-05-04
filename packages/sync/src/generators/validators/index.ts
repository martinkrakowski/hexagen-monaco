export type {
  ValidationSeverity,
  ValidationIssue,
  ValidationResult,
} from "./validation-types.js";
export { createValidationResult } from "./validation-types.js";

export { validatePortAdapterCorrespondence } from "./validate-port-adapter.js";
export { validateManifestToCodeSync } from "./validate-manifest-sync.js";
export {
  validateDependencyGraph,
  validateLayerBoundaries,
} from "./validate-dependencies.js";

import type { BoundedContext } from "../../types/manifest.js";
import type { SyncConfig } from "../../config.js";
import type { ValidationResult } from "./validation-types.js";
import { createValidationResult } from "./validation-types.js";
import { validatePortAdapterCorrespondence } from "./validate-port-adapter.js";
import { validateManifestToCodeSync } from "./validate-manifest-sync.js";
import {
  validateDependencyGraph,
  validateLayerBoundaries,
} from "./validate-dependencies.js";

async function validateBoundedContext(
  moduleDir: string,
  context: BoundedContext,
  config: SyncConfig,
): Promise<ValidationResult> {
  const results = await Promise.all([
    validatePortAdapterCorrespondence(moduleDir, context),
    validateManifestToCodeSync(moduleDir, context),
    validateLayerBoundaries(context),
    validateDependencyGraph(config),
  ]);

  const allIssues = results.flatMap((r) => r.issues);
  return createValidationResult(allIssues);
}

export { validateBoundedContext };
