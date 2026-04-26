import type {
  IArchitectureGraphProviderPort,
  ArchitectureGraphData,
} from "@hexagen/visualization";
import type { Result } from "@hexagen/visualization";

export class ArchitectureGraphProviderAdapter implements IArchitectureGraphProviderPort {
  async getArchitectureGraph(
    projectId: string,
  ): Promise<Result<ArchitectureGraphData, Error>> {
    return {
      success: false,
      error: new Error(
        `ArchitectureGraphProviderAdapter: no real implementation available for project "${projectId}". ` +
          `The graph must be derived from WizardData via the projection pipeline, not loaded from a provider.`,
      ),
    };
  }
}
