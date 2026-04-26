import type { LinterReport } from "@hexagen/governance";
import type { Result } from "@hexagen/shared";
import type { LinterPort } from "../../application/ports/out/linter.port.js";
import type { ArchitectureQueryPort } from "../../application/ports/out/sync-engine.port.js";

export class LinterAdapter implements LinterPort {
  constructor(private readonly architectureQueryPort: ArchitectureQueryPort) {}

  async auditBoundaries(): Promise<Result<LinterReport>> {
    return this.architectureQueryPort.getLinterReport();
  }
}
