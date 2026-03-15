import type {
  IArchitectureGraphProviderPort,
  ArchitectureGraphData,
} from "@hexagen/visualization";
import type { Result } from "@hexagen/visualization";

export class ArchitectureGraphProviderAdapter implements IArchitectureGraphProviderPort {
  async getArchitectureGraph(
    _projectId: string,
  ): Promise<Result<ArchitectureGraphData, Error>> {
    return {
      success: true,
      data: {
        nodes: [],
        edges: [],
      },
    };
  }
}
