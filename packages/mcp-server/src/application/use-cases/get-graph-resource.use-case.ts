import type { ArchitectureGraph } from "@hexagen/visualization";
import type { Result } from "@hexagen/shared";
import type { ArchitectureQueryPort } from "../ports/out/sync-engine.port.js";

export class GetGraphResourceUseCase {
  constructor(private readonly architectureQueryPort: ArchitectureQueryPort) {}

  async execute(): Promise<Result<ArchitectureGraph>> {
    return this.architectureQueryPort.getArchitectureGraph();
  }
}
