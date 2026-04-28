import type {
  ReportGovernancePort,
  LogAgentRemediationInput,
  LogAgentRemediationOutput,
} from "../ports/out/report-governance.port.js";

export class LogAgentRemediationToolUseCase {
  constructor(private readonly port: ReportGovernancePort) {}

  async execute(
    input: LogAgentRemediationInput,
  ): Promise<LogAgentRemediationOutput> {
    return this.port.logAgentRemediation(input);
  }
}
