import type {
  HexagonNode,
  HexagonEdge,
  CanvasViewport,
} from "../../../domain/index.js";

export interface RenderHexagonCanvasInput {
  canvasId: string;
  nodes: HexagonNode[];
  edges: HexagonEdge[];
  viewport?: CanvasViewport;
}

export interface RenderHexagonCanvasOutput {
  canvasId: string;
  viewport: CanvasViewport;
}

export interface RenderHexagonCanvasPort {
  render(input: RenderHexagonCanvasInput): Promise<RenderHexagonCanvasOutput>;
}
