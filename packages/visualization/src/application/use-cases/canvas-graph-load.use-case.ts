import type { IArchitectureGraphProviderPort } from "../ports/out/architecture-graph-provider-port.port.js";
import type { GenerateHexagonalMapPort } from "../ports/in/generate-hexagonal-map.port.js";
import type { HexagonalMapInput } from "../ports/in/hexagonal-map-input.js";
import type {
  RenderableHexagonEdge,
  RenderableHexagonNode,
} from "../ports/in/renderable-graph.js";

export interface CanvasGraphLoadInput {
  projectId?: string;
  /**
   * The map to draw. Was `wizardData: WizardData` (HEX-021) — this layer now
   * speaks only its own vocabulary; `wizardDataToHexagonalMapInput` in
   * infrastructure is what turns a wizard document into one of these.
   */
  map?: HexagonalMapInput;
}

/**
 * What a caller actually receives.
 *
 * These are the *renderable* types, not the bare domain ones. The generator
 * branch below returns `GenerateHexagonalMapOutput`, which since HEX-030 is
 * `RenderableHexagonNode[]` / `RenderableHexagonEdge[]` — graph facts plus the
 * React Flow draw instructions (`extent`, `style`, `variant`, edge
 * `type` / `animated`) that used to sit on the domain node. Declaring the
 * output as `HexagonNode[]` still compiled, because the renderable types are
 * assignable to the domain ones, but it erased every one of those fields (and
 * `HexagonNodeWithLayout`'s `parentId` / `side` / `stats` besides) from the
 * contract, leaving callers to cast or to silently drop them.
 *
 * The `graphProvider` branch returns plain `HexagonNode[]` / `HexagonEdge[]`,
 * which is assignable here because every added member is optional: the widening
 * says "may carry draw instructions", which is exactly the truth for a union of
 * the two branches.
 */
export interface CanvasGraphLoadOutput {
  nodes: RenderableHexagonNode[];
  edges: RenderableHexagonEdge[];
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
