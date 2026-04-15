import type { LinterReport } from "@hexagen/shared";
import type { ArchitectureQueryPort } from "../ports/out/sync-engine.port.js";

export class GetLinterReportResourceUseCase {
  constructor(private readonly architectureQueryPort: ArchitectureQueryPort) {}

  async execute(): Promise<LinterReport> {
    const result = await this.architectureQueryPort.getLinterReport();
    if (!result.success) {
      throw result.error;
    }

    return result.value;
  }
}
