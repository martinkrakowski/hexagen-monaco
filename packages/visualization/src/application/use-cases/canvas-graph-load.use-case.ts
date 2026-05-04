import type { WizardData } from "@hexagen/project-configuration";
import type { HexagonNode, HexagonEdge } from "../../domain/index.js";
import type { IArchitectureGraphProviderPort } from "../ports/out/architecture-graph-provider-port.port.js";
import type { GenerateHexagonalMapPort } from "../ports/in/generate-hexagonal-map.port.js";

export interface CanvasGraphLoadInput {
  projectId?: string;
  wizardData?: WizardData;
}

export interface CanvasGraphLoadOutput {
  nodes: HexagonNode[];
  edges: HexagonEdge[];
  manifestHash: string | null;
}

export class CanvasGraphLoadUseCase {
  constructor(
    private readonly graphProvider: IArchitectureGraphProviderPort,
    private readonly hexMapGenerator: GenerateHexagonalMapPort,
  ) {}

  async execute(
    input: CanvasGraphLoadInput,
  ): Promise<{ success: true; data: CanvasGraphLoadOutput } | { success: false; error: Error }> {
    try {
      if (input.wizardData?.boundedContexts?.length) {
        const result = this.hexMapGenerator.execute({
          wizardData: input.wizardData,
        });

        return {
          success: true,
          data: {
            nodes: result.nodes,
            edges: result.edges,
            manifestHash: null,
          },
        };
      }

      if (!input.projectId) {
        return {
          success: false,
          error: new Error("Either projectId or wizardData must be provided"),
        };
      }

      const graphResult = await this.graphProvider.getArchitectureGraph(input.projectId);

      if (!graphResult.success) {
        return {
          success: false,
          error: graphResult.error,
        };
      }

      return {
        success: true,
        data: {
          nodes: graphResult.data.nodes,
          edges: graphResult.data.edges,
          manifestHash: null,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }
}