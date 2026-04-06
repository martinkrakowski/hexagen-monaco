import type { LinterReport } from "@hexagen/shared";
import type { SyncEnginePort } from "../ports/out/sync-engine.port.js";

export class GetLinterReportResourceUseCase {
  constructor(private readonly syncEnginePort: SyncEnginePort) {}

  async execute(): Promise<LinterReport> {
    const result = await this.syncEnginePort.getLinterReport();
    if (!result.success) {
      throw result.error;
    }

    return result.value;
  }
}
