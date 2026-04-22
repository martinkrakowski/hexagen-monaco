import type { NodeVisualSpec } from "@hexagen/core-domain";
import type { ProjectionValidationResult } from "../../domain/value-objects/projection-validation-result.js";
import type { CheckRealizabilityPort } from "../ports/in/check-realizability.port.js";

export class CheckRealizabilityUseCase {
  constructor(private readonly checker: CheckRealizabilityPort) {}

  execute(spec: NodeVisualSpec): ProjectionValidationResult {
    return this.checker.check(spec);
  }
}
