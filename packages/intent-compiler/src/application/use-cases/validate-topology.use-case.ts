import type { TopologyCheckerPort } from "../ports/in/topology-checker.port";
import type { DomainAST } from "@hexagen/core-domain";
import type { TopologyCheckResult } from "../../domain/value-objects/topology-check-result";

export class ValidateTopologyUseCase {
  constructor(private readonly topologyChecker: TopologyCheckerPort) {}

  execute(ast: DomainAST): TopologyCheckResult {
    return this.topologyChecker.check(ast);
  }
}
