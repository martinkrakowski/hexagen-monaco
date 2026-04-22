import type { Affordance } from "@hexagen/layout-engine";
import type { ProjectionValidationResult } from "../../domain/value-objects/projection-validation-result.js";
import type { CheckAffordanceCompatibilityPort } from "../ports/in/check-affordance-compatibility.port.js";

export class CheckAffordanceCompatibilityUseCase {
  constructor(private readonly checker: CheckAffordanceCompatibilityPort) {}

  execute(affordance: Affordance): ProjectionValidationResult {
    return this.checker.check(affordance);
  }
}
