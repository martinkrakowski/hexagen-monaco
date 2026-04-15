import type { ArchitectureGraph } from "@hexagen/shared";
import type { ArchitectureQueryPort } from "../ports/out/sync-engine.port.js";

export class GetGraphResourceUseCase {
  constructor(private readonly architectureQueryPort: ArchitectureQueryPort) {}

  async execute(): Promise<ArchitectureGraph> {
    const result = await this.architectureQueryPort.getArchitectureGraph();
    if (!result.success) {
      throw result.error;
    }

    return result.value;
  }
}
