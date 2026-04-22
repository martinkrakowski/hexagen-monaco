import type { Result } from "@hexagen/shared";
import type { GovernanceDecision } from "../ports/out/governance-read.port.js";
import type { GovernanceReadPort } from "../ports/out/governance-read.port.js";

export class GetDecisionsResourceUseCase {
  constructor(private readonly governanceReadPort: GovernanceReadPort) {}

  async execute(): Promise<Result<GovernanceDecision[]>> {
    return this.governanceReadPort.getDecisions();
  }
}
