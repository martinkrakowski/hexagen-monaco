import type { NodeVisualSpec } from "@hexagen/core-domain";
import type { ProjectionValidationResult } from "../../../domain/value-objects/projection-validation-result.js";

export interface CheckRealizabilityPort {
  check(spec: NodeVisualSpec): ProjectionValidationResult;
}
