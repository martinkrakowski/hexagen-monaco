import type { LinterReport } from "@hexagen/governance";
import type { LinterPort } from "../ports/out/linter.port.js";

export interface AuditBoundariesInput {
  dry_run?: boolean;
}

export interface AuditBoundariesOutput {
  dryRun: boolean;
  report: LinterReport;
}

export class AuditBoundariesToolUseCase {
  constructor(private readonly linterPort: LinterPort) {}

  async execute(
    input: AuditBoundariesInput = {},
  ): Promise<AuditBoundariesOutput> {
    const result = await this.linterPort.auditBoundaries();
    if (!result.success) {
      throw result.error;
    }

    return {
      dryRun: input.dry_run ?? true,
      report: result.value,
    };
  }
}
