import ELK from "elkjs/lib/elk.bundled.js";
import type {
  GraphLayoutNode,
  GraphLayoutEdge,
} from "../../application/ports/in/graph-layout.port.js";

const elk = new ELK();

export class ElkGraphLayoutAdapter {
  async layout(
    nodes: readonly GraphLayoutNode[],
    edges: readonly GraphLayoutEdge[],
    direction: "TB" | "LR",
  ): Promise<{ positions: ReadonlyArray<{ nodeId: string; x: number; y: number }> }> {
    const layoutNodes = nodes.map((n) => ({
      id: n.id,
      width: n.width,
      height: n.height,
    }));

    const layoutEdges = edges.map((e) => ({
      id: `${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
    }));

    const elkDirection = direction === "TB" ? "DOWN" : "RIGHT";

    const elkGraph = {
      id: "root",
      layoutOptions: {
        "elk.direction": elkDirection,
        "elk.algorithm": "layered",
      },
      children: layoutNodes.map((n) => ({
        id: n.id,
        width: n.width,
        height: n.height,
      })),
      edges: layoutEdges.map((e) => ({
        id: e.id,
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