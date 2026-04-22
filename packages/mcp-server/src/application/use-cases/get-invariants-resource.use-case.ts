import type { GovernanceInvariants } from "../ports/out/governance-read.port.js";
import type { GovernanceReadPort } from "../ports/out/governance-read.port.js";

export class GetInvariantsResourceUseCase {
  constructor(private readonly governanceReadPort: GovernanceReadPort) {}

  async execute(): Promise<GovernanceInvariants> {
    const result = await this.governanceReadPort.getInvariants();
    if (!result.success) {
      throw result.error;
    }

    return result.value;
  }
}
