import type { Result } from "@hexagen/shared";
import type { GovernanceInvariants } from "../ports/out/governance-read.port.js";
import type { GovernanceReadPort } from "../ports/out/governance-read.port.js";

export class GetInvariantsResourceUseCase {
  constructor(private readonly governanceReadPort: GovernanceReadPort) {}

  async execute(): Promise<Result<GovernanceInvariants>> {
    return this.governanceReadPort.getInvariants();
  }
}
