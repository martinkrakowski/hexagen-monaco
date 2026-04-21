import type { DomainAST } from "@hexagen/core-domain";
import type { CardinalityCheckResult } from "../../../domain/value-objects/cardinality-check-result";

export interface CardinalityCheckerPort {
  check(ast: DomainAST): CardinalityCheckResult;
}
