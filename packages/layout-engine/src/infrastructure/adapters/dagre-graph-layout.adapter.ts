import type {
  GraphLayoutPort,
  GraphLayoutNode,
  GraphLayoutEdge,
  GraphLayoutResult,
  GraphLayoutPosition,
} from "../../application/ports/in/graph-layout.port.js";
import dagre from "@dagrejs/dagre";

export class DagreGraphLayoutAdapter implements GraphLayoutPort {
  layout(
    nodes: readonly GraphLayoutNode[],
    edges: readonly GraphLayoutEdge[],
    direction: "TB" | "LR",
  ): GraphLayoutResult {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: direction, nodesep: 80, ranksep: 100 });
    g.setDefaultEdgeLabel(() => ({}));

    for (const node of nodes) {
      g.setNode(node.id, { width: node.width, height: node.height });
    }

    for (const edge of edges) {
      g.setEdge(edge.source, edge.target);
    }

    dagre.layout(g);

    const positions: GraphLayoutPosition[] = nodes.map((node) => {
      const layoutNode = g.node(node.id);
      return {
        nodeId: node.id,
        x: layoutNode.x - node.width / 2,
        y: layoutNode.y - node.height / 2,
      };
    });

    return { positions };
  }
}
