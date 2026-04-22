import type { Affordance } from "@hexagen/layout-engine";
import type { ProjectionValidationResult } from "../../../domain/value-objects/projection-validation-result.js";

export interface CheckAffordanceCompatibilityPort {
  check(affordance: Affordance): ProjectionValidationResult;
}
