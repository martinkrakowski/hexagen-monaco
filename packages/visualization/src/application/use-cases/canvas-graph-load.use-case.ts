import type { HexagonNode, HexagonEdge } from "../../domain/index.js";
import type { IArchitectureGraphProviderPort } from "../ports/out/architecture-graph-provider-port.port.js";
import type { GenerateHexagonalMapPort } from "../ports/in/generate-hexagonal-map.port.js";
import type { HexagonalMapInput } from "../ports/in/hexagonal-map-input.js";

export interface CanvasGraphLoadInput {
  projectId?: string;
  /**
   * The map to draw. Was `wizardData: WizardData` (HEX-021) — this layer now
   * speaks only its own vocabulary; `wizardDataToHexagonalMapInput` in
   * infrastructure is what turns a wizard document into one of these.
   */
  map?: HexagonalMapInput;
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
  ): Promise<
    | { success: true; data: CanvasGraphLoadOutput }
    | { success: false; error: Error }
  > {
    try {
      if (input.map?.contexts.length) {
        const result = this.hexMapGenerator.execute({
          map: input.map,
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
          error: new Error("Either projectId or map must be provided"),
        };
      }

      const graphResult = await this.graphProvider.getArchitectureGraph(
        input.projectId,
      );

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
