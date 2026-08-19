import type { HexagonalMapInput } from "./hexagonal-map-input.js";
import type {
  RenderableHexagonEdge,
  RenderableHexagonNode,
} from "./renderable-graph.js";

export interface GenerateHexagonalMapInput {
  map: HexagonalMapInput;
}

export interface GenerateHexagonalMapOutput {
  nodes: RenderableHexagonNode[];
  edges: RenderableHexagonEdge[];
}

export interface GenerateHexagonalMapPort {
  execute(input: GenerateHexagonalMapInput): GenerateHexagonalMapOutput;
}
