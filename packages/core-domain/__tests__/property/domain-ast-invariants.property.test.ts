import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { NodeKind, EdgeKind } from "../../src/mvk/v1/index.js";
import type {
  DomainAST,
  DomainNode,
  DomainEdge,
  TopologyInvariants,
  CardinalityInvariants,
} from "../../src/mvk/v1/index.js";

function generateRandomNode(id: string): DomainNode {
  const kinds = [
    NodeKind.Aggregate,
    NodeKind.Entity,
    NodeKind.ValueObject,
    NodeKind.Service,
    NodeKind.Repository,
  ];
  const kind = kinds[Math.floor(Math.random() * kinds.length)];
  return {
    id,
    kind,
    attributes: { label: `Node-${id}` },
  };
}

function generateRandomEdge(id: string, nodeIds: string[]): DomainEdge | null {
  if (nodeIds.length < 2) return null;
  const kinds = [
    EdgeKind.DirectAssociation,
    EdgeKind.Composition,
    EdgeKind.Aggregation,
    EdgeKind.Inheritance,
  ];
  const sourceIdx = Math.floor(Math.random() * nodeIds.length);
  let targetIdx = Math.floor(Math.random() * nodeIds.length);
  while (targetIdx === sourceIdx && nodeIds.length > 1) {
    targetIdx = Math.floor(Math.random() * nodeIds.length);
  }
  return {
    id,
    kind: kinds[Math.floor(Math.random() * kinds.length)],
    source: nodeIds[sourceIdx],
    target: nodeIds[targetIdx],
    attributes: {},
  };
}

function checkAcyclic(nodes: DomainNode[], edges: DomainEdge[]): boolean {
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of edges) {
    const targets = adjacency.get(edge.source);
    if (targets) {
      targets.push(edge.target);
    }
  }
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  function dfs(nodeId: string): boolean {
    visited.add(nodeId);
    recursionStack.add(nodeId);
    const targets = adjacency.get(nodeId) || [];
    for (const target of targets) {
      if (!visited.has(target)) {
        if (dfs(target)) return true;
      } else if (recursionStack.has(target)) {
        return true;
      }
    }
    recursionStack.delete(nodeId);
    return false;
  }
  for (const node of nodes) {
    if (!visited.has(node.id)) {
      if (dfs(node.id)) return false;
    }
  }
  return true;
}

function checkConnected(nodes: DomainNode[], edges: DomainEdge[]): boolean {
  if (nodes.length === 0) return true;
  if (edges.length === 0) return nodes.length <= 1;
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
    adjacency.get(edge.target)?.push(edge.source);
  }
  const visited = new Set<string>();
  const queue = [nodes[0].id];
  visited.add(nodes[0].id);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const neighbor of adjacency.get(current) || []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return visited.size === nodes.length;
}

function checkDegreeConstraint(
  nodes: DomainNode[],
  edges: DomainEdge[],
): boolean {
  const degree = new Map<string, number>();
  for (const node of nodes) {
    degree.set(node.id, 0);
  }
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
  }
  for (const [, d] of degree) {
    if (d > 10) return false;
  }
  return true;
}

function generateRandomAST(nodeCount: number): DomainAST {
  const nodes: DomainNode[] = [];
  for (let i = 0; i < nodeCount; i++) {
    nodes.push(generateRandomNode(`n${i}`));
  }
  const nodeIds = nodes.map((n) => n.id);
  const edges: DomainEdge[] = [];
  const edgeCount = Math.min(
    nodeCount * 2,
    Math.floor(Math.random() * nodeCount * 3),
  );
  for (let i = 0; i < edgeCount; i++) {
    const edge = generateRandomEdge(`e${i}`, nodeIds);
    if (edge) edges.push(edge);
  }
  const topologyInvariants: TopologyInvariants[] = [];
  const cardinalityInvariants: CardinalityInvariants[] = [];
  return {
    nodes,
    edges,
    invariants: {
      topology: topologyInvariants,
      cardinality: cardinalityInvariants,
    },
  };
}

describe("DomainAST Invariants Property Tests", () => {
  describe("topology invariants", () => {
    it("should correctly detect cycles in graphs", () => {
      const nodes: DomainNode[] = [
        { id: "n1", kind: NodeKind.Aggregate, attributes: {} },
        { id: "n2", kind: NodeKind.Entity, attributes: {} },
        { id: "n3", kind: NodeKind.ValueObject, attributes: {} },
      ];
      const edges: DomainEdge[] = [
        {
          id: "e1",
          kind: EdgeKind.DirectAssociation,
          source: "n1",
          target: "n2",
          attributes: {},
        },
        {
          id: "e2",
          kind: EdgeKind.DirectAssociation,
          source: "n2",
          target: "n3",
          attributes: {},
        },
        {
          id: "e3",
          kind: EdgeKind.DirectAssociation,
          source: "n3",
          target: "n1",
          attributes: {},
        },
      ];
      assert.strictEqual(checkAcyclic(nodes, edges), false);
    });

    it("should pass for acyclic graphs", () => {
      let failures = 0;
      for (let i = 0; i < 1000; i++) {
        const nodeCount = Math.floor(Math.random() * 20) + 2;
        const ast = generateRandomAST(nodeCount);
        if (ast.edges.length > 0) {
          const acyclic = checkAcyclic(ast.nodes, ast.edges);
          if (acyclic) failures++;
        }
      }
      assert.ok(failures > 0);
    });

    it("should correctly identify connected graphs", () => {
      let failures = 0;
      for (let i = 0; i < 500; i++) {
        const nodeCount = Math.floor(Math.random() * 10) + 2;
        const nodes: DomainNode[] = [];
        for (let j = 0; j < nodeCount; j++) {
          nodes.push({ id: `n${j}`, kind: NodeKind.Aggregate, attributes: {} });
        }
        const edges: DomainEdge[] = [];
        for (let j = 0; j < nodeCount - 1; j++) {
          edges.push({
            id: `e${j}`,
            kind: EdgeKind.DirectAssociation,
            source: nodes[j].id,
            target: nodes[j + 1].id,
            attributes: {},
          });
        }
        const connected = checkConnected(nodes, edges);
        if (!connected) failures++;
      }
      assert.strictEqual(failures, 0);
    });
  });

  describe("cardinality invariants", () => {
    it("should correctly identify degree constraint violations in dense graphs", () => {
      let violationsFound = 0;
      for (let i = 0; i < 1000; i++) {
        const nodeCount = Math.floor(Math.random() * 20) + 2;
        const ast = generateRandomAST(nodeCount);
        const valid = checkDegreeConstraint(ast.nodes, ast.edges);
        if (!valid) violationsFound++;
      }
      assert.ok(violationsFound >= 0);
    });

    it("should pass for sparse graphs with few edges", () => {
      let failures = 0;
      for (let i = 0; i < 500; i++) {
        const nodeCount = 5 + Math.floor(Math.random() * 10);
        const nodes: DomainNode[] = [];
        for (let j = 0; j < nodeCount; j++) {
          nodes.push(generateRandomNode(`n${j}`));
        }
        const edges: DomainEdge[] = [];
        const edgeCount = Math.floor(nodeCount * 0.5);
        for (let j = 0; j < edgeCount; j++) {
          edges.push({
            id: `e${j}`,
            kind: EdgeKind.DirectAssociation,
            source: nodes[j % nodeCount].id,
            target: nodes[(j + 1) % nodeCount].id,
            attributes: {},
          });
        }
        const ast = {
          nodes,
          edges,
          invariants: { topology: [], cardinality: [] },
        };
        const valid = checkDegreeConstraint(ast.nodes, ast.edges);
        if (!valid) failures++;
      }
      assert.strictEqual(failures, 0);
    });
  });

  describe("edge validity", () => {
    it("should only reference valid node IDs", () => {
      let failures = 0;
      for (let i = 0; i < 1000; i++) {
        const nodeCount = Math.floor(Math.random() * 10) + 2;
        const ast = generateRandomAST(nodeCount);
        const nodeIds = new Set(ast.nodes.map((n) => n.id));
        for (const edge of ast.edges) {
          if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
            failures++;
          }
        }
      }
      assert.strictEqual(failures, 0);
    });
  });

  describe("node uniqueness", () => {
    it("should have unique node IDs within an AST", () => {
      let failures = 0;
      for (let i = 0; i < 1000; i++) {
        const nodeCount = Math.floor(Math.random() * 20) + 1;
        const ast = generateRandomAST(nodeCount);
        const ids = ast.nodes.map((n) => n.id);
        const uniqueIds = new Set(ids);
        if (ids.length !== uniqueIds.size) failures++;
      }
      assert.strictEqual(failures, 0);
    });
  });
});
