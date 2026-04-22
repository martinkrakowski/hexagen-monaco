import type { WorkspaceContext } from "../ports/out/governance-read.port.js";
import type { GovernanceReadPort } from "../ports/out/governance-read.port.js";

export class GetWorkspaceContextResourceUseCase {
  constructor(private readonly governanceReadPort: GovernanceReadPort) {}

  async execute(): Promise<WorkspaceContext> {
    const result = await this.governanceReadPort.getWorkspaceContext();
    if (!result.success) {
      throw result.error;
    }

    return result.value;
  }
}
