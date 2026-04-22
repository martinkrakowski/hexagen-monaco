import type { DomainAST } from "@hexagen/core-domain";
import type { TopologyCheckResult } from "../../../domain/value-objects/topology-check-result.js";

export interface TopologyCheckerPort {
  check(ast: DomainAST): TopologyCheckResult;
}
