import type { CardinalityCheckerPort } from "../../src/application/ports/in/cardinality-checker.port";
import type { DomainAST } from "@hexagen/core-domain";
import type { CardinalityCheckResult } from "../../src/domain/value-objects/cardinality-check-result";

export class FakeCardinalityChecker implements CardinalityCheckerPort {
  private _checkCallCount = 0;
  private _lastAst: DomainAST | null = null;

  constructor(
    private readonly defaultResult: CardinalityCheckResult = {
      isValid: true,
      violations: [],
    },
    private readonly astOverride?: (ast: DomainAST) => CardinalityCheckResult,
  ) {}

  check(ast: DomainAST): CardinalityCheckResult {
    this._lastAst = ast;
    this._checkCallCount++;
    if (this.astOverride) {
      return this.astOverride(ast);
    }
    return this.defaultResult;
  }

  get checkCallCount(): number {
    return this._checkCallCount;
  }

  get lastAst(): DomainAST | null {
    return this._lastAst;
  }
}
