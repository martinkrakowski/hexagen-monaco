import type {
  GraphLayoutPort,
  GraphLayoutNode,
  GraphLayoutEdge,
  GraphLayoutResult,
} from "../ports/in/graph-layout.port.js";

export class SolveGraphLayoutUseCase {
  constructor(private readonly layoutPort: GraphLayoutPort) {}

  execute(
    nodes: readonly GraphLayoutNode[],
    edges: readonly GraphLayoutEdge[],
    direction: "TB" | "LR" = "TB",
  ): Promise<GraphLayoutResult> {
    const result = this.layoutPort.layout(nodes, edges, direction);
    if (result instanceof Promise) {
      return result;
    }
    return Promise.resolve(result);
  }
}
