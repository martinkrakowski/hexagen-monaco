import { DomainAST } from "@hexagen/core-domain";
import { CardinalityCheckResult } from "../../domain/value-objects/cardinality-check-result";

export interface CardinalityCheckerPort {
  check(ast: DomainAST): CardinalityCheckResult;
}