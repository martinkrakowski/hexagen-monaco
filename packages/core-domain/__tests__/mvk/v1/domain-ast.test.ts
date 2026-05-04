import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NodeKind,
  EdgeKind,
  DomainAST,
  DomainNode,
  DomainEdge,
} from "../../../src/mvk/v1/index.js";

const ALL_NODE_KINDS = Object.values(NodeKind);
const ALL_EDGE_KINDS = Object.values(EdgeKind);

describe("DomainAST structure invariants", () => {
  it("DomainNode has required id, kind, attributes fields", () => {
    const node: DomainNode = {
      id: "node-1",
      kind: NodeKind.Entity,
      attributes: { label: "Order" },
    };

    assert.strictEqual(node.id, "node-1");
    assert.strictEqual(node.kind, NodeKind.Entity);
    assert.strictEqual(typeof node.attributes, "object");
  });

  it("DomainEdge has required id, kind, source, target, attributes fields", () => {
    const edge: DomainEdge = {
      id: "edge-1",
      kind: EdgeKind.Dependency,
      source: "node-1",
      target: "node-2",
      attributes: {},
    };

    assert.strictEqual(edge.id, "edge-1");
    assert.strictEqual(edge.kind, EdgeKind.Dependency);
    assert.strictEqual(edge.source, "node-1");
    assert.strictEqual(edge.target, "node-2");
  });

  it("DomainAST has nodes, edges, and invariants", () => {
    const ast: DomainAST = {
      nodes: [],
      edges: [],
      invariants: { topology: [], cardinality: [] },
    };

    assert.ok(Array.isArray(ast.nodes));
    assert.ok(Array.isArray(ast.edges));
    assert.ok(Array.isArray(ast.invariants.topology));
    assert.ok(Array.isArray(ast.invariants.cardinality));
  });

  it("DomainAST with populated nodes and edges", () => {
    const ast: DomainAST = {
      nodes: [
        { id: "n1", kind: NodeKind.Aggregate, attributes: {} },
        { id: "n2", kind: NodeKind.Entity, attributes: {} },
      ],
      edges: [
        {
          id: "e1",
          kind: EdgeKind.Composition,
          source: "n1",
          target: "n2",
          attributes: {},
        },
      ],
      invariants: { topology: [], cardinality: [] },
    };

    assert.strictEqual(ast.nodes.length, 2);
    assert.strictEqual(ast.edges.length, 1);
    assert.strictEqual(ast.edges[0].source, "n1");
    assert.strictEqual(ast.edges[0].target, "n2");
  });
});

describe("NodeKind and EdgeKind coverage", () => {
  it("all NodeKind values can be used in DomainNode.kind", () => {
    for (const kind of ALL_NODE_KINDS) {
      const node: DomainNode = { id: `node-${kind}`, kind, attributes: {} };
      assert.strictEqual(node.kind, kind);
    }
  });

  it("all EdgeKind values can be used in DomainEdge.kind", () => {
    for (const kind of ALL_EDGE_KINDS) {
      const edge: DomainEdge = {
        id: `edge-${kind}`,
        kind,
        source: "n1",
        target: "n2",
        attributes: {},
      };
      assert.strictEqual(edge.kind, kind);
    }
  });

  it("number of NodeKind values matches expected count", () => {
    assert.strictEqual(ALL_NODE_KINDS.length, 20);
  });

  it("number of EdgeKind values matches expected count", () => {
    assert.strictEqual(ALL_EDGE_KINDS.length, 14);
  });
});
