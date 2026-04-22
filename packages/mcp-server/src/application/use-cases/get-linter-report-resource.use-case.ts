import type { LinterReport, Result } from "@hexagen/shared";
import type { ArchitectureQueryPort } from "../ports/out/sync-engine.port.js";

export class GetLinterReportResourceUseCase {
  constructor(private readonly architectureQueryPort: ArchitectureQueryPort) {}

  async execute(): Promise<Result<LinterReport>> {
    return this.architectureQueryPort.getLinterReport();
  }
}
