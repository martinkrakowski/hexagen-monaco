import { DomainAST } from "@hexagen/core-domain";
import { CardinalityCheckerPort } from "../../../application/ports/in/cardinality-checker.port";
import { CardinalityCheckResult } from "../../../domain/value-objects/cardinality-check-result";

export class RRPCardinalityCheckerAdapter implements CardinalityCheckerPort {
  check(ast: DomainAST): CardinalityCheckResult {
    // TODO: Implement cardinality checking logic using RRP (Relative Remaining Places)
    // For now, return a mock result
    return {
      isValid: true,
      violations: [],
    };
  }
}