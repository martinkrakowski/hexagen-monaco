import type { LinterConfigEntry } from "../ports/out/governance-read.port.js";
import type { GovernanceReadPort } from "../ports/out/governance-read.port.js";

export class GetLinterConfigResourceUseCase {
  constructor(private readonly governanceReadPort: GovernanceReadPort) {}

  async execute(): Promise<LinterConfigEntry[]> {
    const result = await this.governanceReadPort.getLinterConfig();
    if (!result.success) {
      throw result.error;
    }

    return result.value;
  }
}
