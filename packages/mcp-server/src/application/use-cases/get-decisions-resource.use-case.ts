import type { GovernanceDecision } from "../ports/out/governance-read.port.js";
import type { GovernanceReadPort } from "../ports/out/governance-read.port.js";

export class GetDecisionsResourceUseCase {
  constructor(private readonly governanceReadPort: GovernanceReadPort) {}

  async execute(): Promise<GovernanceDecision[]> {
    const result = await this.governanceReadPort.getDecisions();
    if (!result.success) {
      throw result.error;
    }

    return result.value;
  }
}
