import type { TopologyCheckerPort } from "../../src/application/ports/in/topology-checker.port";
import type { DomainAST } from "@hexagen/core-domain";
import type { TopologyCheckResult } from "../../src/domain/value-objects/topology-check-result";

export class FakeTopologyChecker implements TopologyCheckerPort {
  private _checkCallCount = 0;
  private _lastAst: DomainAST | null = null;

  constructor(
    private readonly defaultResult: TopologyCheckResult = {
      isValid: true,
      violations: [],
    },
    private readonly astOverride?: (ast: DomainAST) => TopologyCheckResult,
  ) {}

  check(ast: DomainAST): TopologyCheckResult {
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
