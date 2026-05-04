import ELK from "elkjs/lib/elk.bundled.js";
import type {
  GraphLayoutPort,
  GraphLayoutNode,
  GraphLayoutEdge,
  GraphLayoutResult,
} from "../../application/ports/in/graph-layout.port.js";

const elk = new ELK();

export class ElkGraphLayoutAdapter implements GraphLayoutPort {
  async layout(
    nodes: readonly GraphLayoutNode[],
    edges: readonly GraphLayoutEdge[],
    direction: "TB" | "LR",
  ): Promise<GraphLayoutResult> {
    const elkDirection = direction === "TB" ? "DOWN" : "RIGHT";

    const elkGraph = {
      id: "root",
      layoutOptions: {
        "elk.direction": elkDirection,
        "elk.algorithm": "layered",
      },
      children: nodes.map((n) => ({
        id: n.id,
        width: n.width,
        height: n.height,
      })),
      // NOTE: ${source}-${target} edge IDs may collide in multi-edge graphs
      edges: edges.map((e) => ({
        id: `${e.source}-${e.target}`,
        sources: [e.source],
        targets: [e.target],
      })),
    };

    const layoutedGraph = await elk.layout(elkGraph);

    const positions: { nodeId: string; x: number; y: number }[] = [];
    for (const child of layoutedGraph.children ?? []) {
      if (child.x !== undefined && child.y !== undefined) {
        positions.push({ nodeId: child.id, x: child.x, y: child.y });
      }
    }

    return { positions };
  }
}
