import {
  ArchitectureGraphSchema,
  type ArchitectureGraph,
} from "@hexagen/visualization";
import type { ArchitectureGraphProviderPort } from "../ports/out/architecture-graph-provider.port.js";

export class GetArchitectureGraphUseCase {
  constructor(private readonly provider: ArchitectureGraphProviderPort) {}

  async execute(projectId: string): Promise<ArchitectureGraph> {
    const result = await this.provider.getArchitectureGraph(projectId);
    if (!result.success) {
      throw result.error;
    }

    return ArchitectureGraphSchema.parse(result.value);
  }
}
