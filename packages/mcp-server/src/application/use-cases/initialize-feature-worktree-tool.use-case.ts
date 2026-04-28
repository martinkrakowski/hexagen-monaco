import type { ReportGovernancePort, InitializeFeatureWorktreeInput, InitializeFeatureWorktreeOutput } from "../ports/out/report-governance.port.js";

export class InitializeFeatureWorktreeToolUseCase {
  constructor(private readonly port: ReportGovernancePort) {}

  async execute(input: InitializeFeatureWorktreeInput): Promise<InitializeFeatureWorktreeOutput> {
    return this.port.initializeFeatureWorktree(input);
  }
}
