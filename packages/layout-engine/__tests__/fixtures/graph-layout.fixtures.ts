import type {
  GraphLayoutNode,
  GraphLayoutEdge,
} from "../../src/application/ports/in/graph-layout.port.js";

// Note: randomId kept as reference for potential future use

/**
 * Generates a random dimension (width or height in pixels)
 * Range: 40px to 200px (realistic UI node sizes)
 */
function randomDimension(): number {
  return Math.floor(Math.random() * 160) + 40;
}

/**
 * Generates a random acyclic graph as an array of nodes and edges.
 * Ensures:
 * - At least 1 node, up to maxNodes
 * - All edges reference valid node IDs
 * - No cycles (edges always point to later nodes in the node list)
 */
export function generateRandomGraph(nodeCount: number = 5): {
  nodes: GraphLayoutNode[];
  edges: GraphLayoutEdge[];
} {
  // Clamp node count to reasonable range
  const count = Math.max(1, Math.min(nodeCount, 100));

  // Generate nodes with unique IDs
  const nodeIds: string[] = [];
  const nodes: GraphLayoutNode[] = [];

  for (let i = 0; i < count; i++) {
    const id = `n${i}`; // Use deterministic IDs for easier debugging
    nodeIds.push(id);
    nodes.push({
      id,
      width: randomDimension(),
      height: randomDimension(),
    });
  }

  // Generate edges: randomly connect nodes, but only forward (to prevent cycles)
  const edges: GraphLayoutEdge[] = [];
  const edgeCount = Math.floor(Math.random() * (count - 1));

  for (let i = 0; i < edgeCount; i++) {
    const sourceIdx = Math.floor(Math.random() * (count - 1));
    const targetIdx =
      sourceIdx + 1 + Math.floor(Math.random() * (count - sourceIdx - 1));

    edges.push({
      source: nodeIds[sourceIdx],
      target: nodeIds[targetIdx],
    });
  }

  return { nodes, edges };
}

/**
 * Generates 1000 random graphs for property-based testing
 */
export function generatePropertyTestFixtures() {
  const fixtures: Array<{
    nodes: GraphLayoutNode[];
    edges: GraphLayoutEdge[];
    direction: "TB" | "LR";
  }> = [];

  for (let i = 0; i < 1000; i++) {
    const nodeCount = Math.floor(Math.random() * 50) + 1; // 1-50 nodes
    const { nodes, edges } = generateRandomGraph(nodeCount);
    const direction = Math.random() > 0.5 ? "TB" : "LR";

    fixtures.push({ nodes, edges, direction });
  }

  return fixtures;
}

/**
 * Validates that a layout result satisfies geometric feasibility properties
 */
export function validateLayoutFeasibility(
  nodes: GraphLayoutNode[],
  positionResult: Array<{ nodeId: string; x: number; y: number }>,
): {
  isValid: boolean;
  violations: string[];
} {
  const violations: string[] = [];

  // Property 1: All nodes have positions
  const positionMap = new Map(positionResult.map((p) => [p.nodeId, p]));
  for (const node of nodes) {
    if (!positionMap.has(node.id)) {
      violations.push(`Node ${node.id} has no position in result`);
    }
  }

  // Property 2: No positions for non-existent nodes
  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const pos of positionResult) {
    if (!nodeIds.has(pos.nodeId)) {
      violations.push(`Position result contains unknown node ${pos.nodeId}`);
    }
  }

  // Property 3: Coordinates are numbers (not NaN, not Infinity)
  for (const pos of positionResult) {
    if (!Number.isFinite(pos.x)) {
      violations.push(`Node ${pos.nodeId} has invalid x coordinate: ${pos.x}`);
    }
    if (!Number.isFinite(pos.y)) {
      violations.push(`Node ${pos.nodeId} has invalid y coordinate: ${pos.y}`);
    }
  }

  return {
    isValid: violations.length === 0,
    violations,
  };
}
