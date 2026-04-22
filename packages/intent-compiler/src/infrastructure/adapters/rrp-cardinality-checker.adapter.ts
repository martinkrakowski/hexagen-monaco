import type { DomainAST } from "@hexagen/core-domain";
import type { CardinalityCheckerPort } from "../../application/ports/in/cardinality-checker.port.js";
import type { CardinalityCheckResult } from "../../domain/value-objects/cardinality-check-result.js";

export class RRPCardinalityCheckerAdapter implements CardinalityCheckerPort {
  check(_ast: DomainAST): CardinalityCheckResult {
    // TODO: Implement cardinality checking logic using RRP (Resolved Rule Program)
    // For now, return a mock result
    return {
      isValid: true,
      violations: [],
    };
  }
}
