import type { LinterReport, Result } from "@hexagen/shared";
import type { LinterPort } from "../../application/ports/out/linter.port.js";
import type { SyncEnginePort } from "../../application/ports/out/sync-engine.port.js";

export class LinterAdapter implements LinterPort {
  constructor(private readonly syncEnginePort: SyncEnginePort) {}

  async auditBoundaries(): Promise<Result<LinterReport>> {
    return this.syncEnginePort.getLinterReport();
  }
}
