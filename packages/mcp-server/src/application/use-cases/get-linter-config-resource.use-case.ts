import type { Result } from "@hexagen/shared";
import type { LinterConfigEntry } from "../ports/out/governance-read.port.js";
import type { GovernanceReadPort } from "../ports/out/governance-read.port.js";

export class GetLinterConfigResourceUseCase {
  constructor(private readonly governanceReadPort: GovernanceReadPort) {}

  async execute(): Promise<Result<LinterConfigEntry[]>> {
    return this.governanceReadPort.getLinterConfig();
  }
}
