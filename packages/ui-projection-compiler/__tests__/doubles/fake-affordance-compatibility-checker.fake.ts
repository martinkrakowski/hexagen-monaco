import type { Affordance } from "@hexagen/layout-engine";
import type { CheckAffordanceCompatibilityPort } from "../../src/application/ports/in/check-affordance-compatibility.port.js";
import type { ProjectionValidationResult } from "../../src/domain/value-objects/projection-validation-result.js";
import { createValidationResult } from "../../src/domain/value-objects/projection-validation-result.js";

export class FakeAffordanceCompatibilityChecker implements CheckAffordanceCompatibilityPort {
  readonly calls: Affordance[] = [];

  constructor(
    private readonly result: ProjectionValidationResult = createValidationResult(
      true,
    ),
  ) {}

  check(affordance: Affordance): ProjectionValidationResult {
    this.calls.push(affordance);
    return this.result;
  }
}
