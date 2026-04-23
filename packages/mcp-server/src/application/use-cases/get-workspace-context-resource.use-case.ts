import type { Result } from "@hexagen/shared";
import type { WorkspaceContext } from "../ports/out/governance-read.port.js";
import type { GovernanceReadPort } from "../ports/out/governance-read.port.js";

export class GetWorkspaceContextResourceUseCase {
  constructor(private readonly governanceReadPort: GovernanceReadPort) {}

  async execute(): Promise<Result<WorkspaceContext>> {
    return this.governanceReadPort.getWorkspaceContext();
  }
}
