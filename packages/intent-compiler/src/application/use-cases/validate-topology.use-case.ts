import { TopologyCheckerPort } from "../ports/in/topology-checker.port";
import { DomainAST } from "@hexagen/core-domain";
import { TopologyCheckResult } from "../../domain/value-objects/topology-check-result";

export class ValidateTopologyUseCase {
  constructor(private readonly topologyChecker: TopologyCheckerPort) {}

  execute(ast: DomainAST): TopologyCheckResult {
    return this.topologyChecker.check(ast);
  }
}