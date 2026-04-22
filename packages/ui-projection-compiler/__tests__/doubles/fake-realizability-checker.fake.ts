import type { NodeVisualSpec } from "@hexagen/core-domain";
import type { CheckRealizabilityPort } from "../../src/application/ports/in/check-realizability.port.js";
import type { ProjectionValidationResult } from "../../src/domain/value-objects/projection-validation-result.js";
import { createValidationResult } from "../../src/domain/value-objects/projection-validation-result.js";

export class FakeRealizabilityChecker implements CheckRealizabilityPort {
  readonly calls: NodeVisualSpec[] = [];

  constructor(
    private readonly result: ProjectionValidationResult = createValidationResult(
      true,
    ),
  ) {}

  check(spec: NodeVisualSpec): ProjectionValidationResult {
    this.calls.push(spec);
    return this.result;
  }
}
