import type { DomainAST } from "@hexagen/core-domain";
import type { CardinalityCheckResult } from "../../../domain/value-objects/cardinality-check-result.js";

export interface CardinalityCheckerPort {
  check(ast: DomainAST): CardinalityCheckResult;
}
