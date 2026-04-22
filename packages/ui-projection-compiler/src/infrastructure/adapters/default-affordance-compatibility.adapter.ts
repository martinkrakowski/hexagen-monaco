import type { Affordance } from "@hexagen/layout-engine";
import type { CheckAffordanceCompatibilityPort } from "../../application/ports/in/check-affordance-compatibility.port.js";
import type { ProjectionValidationResult } from "../../domain/value-objects/projection-validation-result.js";
import { createValidationResult } from "../../domain/value-objects/projection-validation-result.js";
import type { ProjectionError } from "../../domain/value-objects/projection-error.js";
import { createProjectionError } from "../../domain/value-objects/projection-error.js";

/**
 * DefaultAffordanceCompatibilityAdapter — validates that a layout Affordance
 * is compatible with the projection system.
 *
 * An affordance is compatible iff:
 *   - connectable → at least one side is exposed
 *   - resizable implies movable (cannot resize a pinned node)
 */
export class DefaultAffordanceCompatibilityAdapter implements CheckAffordanceCompatibilityPort {
  check(affordance: Affordance): ProjectionValidationResult {
    const errors: ProjectionError[] = [];
    const warnings: ProjectionError[] = [];

    if (affordance.connectable && affordance.sides.length === 0) {
      errors.push(
        createProjectionError(
          "incompatible-affordance",
          "Connectable affordance must expose at least one side",
          affordance.nodeId,
          { sides: affordance.sides },
        ),
      );
    }

    if (affordance.resizable && !affordance.movable) {
      warnings.push(
        createProjectionError(
          "incompatible-affordance",
          "Resizable affordance without movable affordance is unusual",
          affordance.nodeId,
        ),
      );
    }

    return createValidationResult(errors.length === 0, errors, warnings);
  }
}
