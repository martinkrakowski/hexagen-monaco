import type { ReportGovernancePort, SubmitArchitecturalSpecInput, SubmitArchitecturalSpecOutput } from "../ports/out/report-governance.port.js";

export class SubmitArchitecturalSpecToolUseCase {
  constructor(private readonly port: ReportGovernancePort) {}

  async execute(input: SubmitArchitecturalSpecInput): Promise<SubmitArchitecturalSpecOutput> {
    return this.port.submitArchitecturalSpec(input);
  }
}
