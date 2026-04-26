import type {
  GraphLayoutPort,
  GraphLayoutNode,
  GraphLayoutEdge,
  GraphLayoutResult,
} from "../../src/application/ports/in/graph-layout.port.js";

/**
 * Stub implementation of GraphLayoutPort for testing.
 * Returns a simple deterministic layout without invoking dagre.
 */
export class GraphLayoutPortFake implements GraphLayoutPort {
  layout(
    nodes: readonly GraphLayoutNode[],
    edges: readonly GraphLayoutEdge[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    direction: "TB" | "LR" = "TB",
  ): GraphLayoutResult {
    // Simple deterministic layout: arrange nodes in a grid
    // This fake exists to allow unit-testing SolveGraphLayoutUseCase logic
    // without depending on dagre. For integration testing, use DagreGraphLayoutAdapter.

    const cols = Math.ceil(Math.sqrt(nodes.length));
    const spacing = 150; // pixels between nodes

    const positions = nodes.map((node, index) => ({
      nodeId: node.id,
      x: (index % cols) * spacing,
      y: Math.floor(index / cols) * spacing,
    }));

    return { positions };
  }
}

/**
 * Introspectable fake for testing: track calls to layout()
 */
export class IntrospectableGraphLayoutPortFake extends GraphLayoutPortFake {
  private calls: Array<{
    nodes: readonly GraphLayoutNode[];
    edges: readonly GraphLayoutEdge[];
    direction: "TB" | "LR";
  }> = [];

  override layout(
    nodes: readonly GraphLayoutNode[],
    edges: readonly GraphLayoutEdge[],
    direction: "TB" | "LR" = "TB",
  ): GraphLayoutResult {
    this.calls.push({ nodes, edges, direction });
    return super.layout(nodes, edges, direction);
  }

  getCallCount(): number {
    return this.calls.length;
  }

  getLastCall() {
    return this.calls[this.calls.length - 1];
  }

  reset(): void {
    this.calls = [];
  }
}
