import type { DomainAST } from "@hexagen/core-domain";
import type { CardinalityCheckerPort } from "../ports/in/cardinality-checker.port";
import type { CardinalityCheckResult } from "../../domain/value-objects/cardinality-check-result";

export class ValidateCardinalityUseCase {
  constructor(private readonly cardinalityChecker: CardinalityCheckerPort) {}

  execute(ast: DomainAST): CardinalityCheckResult {
    return this.cardinalityChecker.check(ast);
  }
}
