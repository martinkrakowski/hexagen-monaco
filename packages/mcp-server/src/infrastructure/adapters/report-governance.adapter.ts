import type {
  ReportGovernancePort,
  InitializeFeatureWorktreeInput,
  InitializeFeatureWorktreeOutput,
  SubmitArchitecturalSpecInput,
  SubmitArchitecturalSpecOutput,
  LogAgentRemediationInput,
  LogAgentRemediationOutput,
  GetFeatureContextInput,
  GetFeatureContextOutput,
} from "../../application/ports/out/report-governance.port.js";

export class ReportGovernanceAdapter implements ReportGovernancePort {
  constructor(private readonly workspaceRoot: string) {}

  async initializeFeatureWorktree(input: InitializeFeatureWorktreeInput): Promise<InitializeFeatureWorktreeOutput> {
    throw new Error("Not implemented");
  }

  async submitArchitecturalSpec(input: SubmitArchitecturalSpecInput): Promise<SubmitArchitecturalSpecOutput> {
    throw new Error("Not implemented");
  }

  async logAgentRemediation(input: LogAgentRemediationInput): Promise<LogAgentRemediationOutput> {
    throw new Error("Not implemented");
  }

  async getFeatureContext(input: GetFeatureContextInput): Promise<GetFeatureContextOutput> {
    throw new Error("Not implemented");
  }
}
