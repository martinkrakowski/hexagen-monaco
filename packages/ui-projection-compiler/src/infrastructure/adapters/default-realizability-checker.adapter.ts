import type { NodeVisualSpec } from "@hexagen/core-domain";
import type { CheckRealizabilityPort } from "../../application/ports/in/check-realizability.port.js";
import type { ProjectionValidationResult } from "../../domain/value-objects/projection-validation-result.js";
import { createValidationResult } from "../../domain/value-objects/projection-validation-result.js";
import type { ProjectionError } from "../../domain/value-objects/projection-error.js";
import { createProjectionError } from "../../domain/value-objects/projection-error.js";

/**
 * DefaultRealizabilityCheckerAdapter — reverse validator that rejects
 * unrealizable NodeVisualSpecs before they reach the renderer.
 *
 * A spec is realizable iff its nodeId is a non-empty string.
 * Additional checks can be layered as MVK evolves.
 */
export class DefaultRealizabilityCheckerAdapter implements CheckRealizabilityPort {
  check(spec: NodeVisualSpec): ProjectionValidationResult {
    const errors: ProjectionError[] = [];

    if (!spec.nodeId || typeof spec.nodeId !== "string") {
      errors.push(
        createProjectionError(
          "unrealizable-projection",
          "NodeVisualSpec.nodeId must be a non-empty string",
          spec.nodeId,
          { actual: spec.nodeId },
        ),
      );
    }

    return createValidationResult(errors.length === 0, errors, []);
  }
}
