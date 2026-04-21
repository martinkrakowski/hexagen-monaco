import { DomainAST } from "@hexagen/core-domain";
import { TopologyCheckResult } from "../../domain/value-objects/topology-check-result";

export interface TopologyCheckerPort {
  check(ast: DomainAST): TopologyCheckResult;
}