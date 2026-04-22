import type { ProjectionError } from "./projection-error.js";

export interface ProjectionValidationResult {
  readonly realizable: boolean;
  readonly errors: ReadonlyArray<ProjectionError>;
  readonly warnings: ReadonlyArray<ProjectionError>;
}

export function createValidationResult(
  realizable: boolean,
  errors: ReadonlyArray<ProjectionError> = [],
  warnings: ReadonlyArray<ProjectionError> = [],
): ProjectionValidationResult {
  return { realizable, errors, warnings };
}
