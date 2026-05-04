import type {
  GraphLayoutPort,
  GraphLayoutNode,
  GraphLayoutEdge,
  GraphLayoutResult,
} from "../ports/in/graph-layout.port.js";

export class SolveGraphLayoutUseCase {
  constructor(private readonly layoutPort: GraphLayoutPort) {}

  async execute(
    nodes: readonly GraphLayoutNode[],
    edges: readonly GraphLayoutEdge[],
    direction: "TB" | "LR" = "TB",
  ): Promise<GraphLayoutResult> {
    return this.layoutPort.layout(nodes, edges, direction);
  }
}
