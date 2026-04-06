import type { ArchitectureGraph } from "@hexagen/shared";
import type { SyncEnginePort } from "../ports/out/sync-engine.port.js";

export class GetGraphResourceUseCase {
  constructor(private readonly syncEnginePort: SyncEnginePort) {}

  async execute(): Promise<ArchitectureGraph> {
    const result = await this.syncEnginePort.getArchitectureGraph();
    if (!result.success) {
      throw result.error;
    }

    return result.value;
  }
}
