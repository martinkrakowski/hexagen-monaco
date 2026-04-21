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

    expect(node.id).toBe("node-1");
    expect(node.kind).toBe(NodeKind.Entity);
    expect(typeof node.attributes).toBe("object");
  });

  it("DomainEdge has required id, kind, source, target, attributes fields", () => {
    const edge: DomainEdge = {
      id: "edge-1",
      kind: EdgeKind.Dependency,
      source: "node-1",
      target: "node-2",
      attributes: {},
    };

    expect(edge.id).toBe("edge-1");
    expect(edge.kind).toBe(EdgeKind.Dependency);
    expect(edge.source).toBe("node-1");
    expect(edge.target).toBe("node-2");
  });

  it("DomainAST has nodes, edges, and invariants", () => {
    const ast: DomainAST = {
      nodes: [],
      edges: [],
      invariants: { topology: [], cardinality: [] },
    };

    expect(Array.isArray(ast.nodes)).toBe(true);
    expect(Array.isArray(ast.edges)).toBe(true);
    expect(Array.isArray(ast.invariants.topology)).toBe(true);
    expect(Array.isArray(ast.invariants.cardinality)).toBe(true);
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

    expect(ast.nodes).toHaveLength(2);
    expect(ast.edges).toHaveLength(1);
    expect(ast.edges[0].source).toBe("n1");
    expect(ast.edges[0].target).toBe("n2");
  });
});

describe("NodeKind and EdgeKind coverage", () => {
  it("all NodeKind values can be used in DomainNode.kind", () => {
    for (const kind of ALL_NODE_KINDS) {
      const node: DomainNode = { id: `node-${kind}`, kind, attributes: {} };
      expect(node.kind).toBe(kind);
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
      expect(edge.kind).toBe(kind);
    }
  });

  it("number of NodeKind values matches expected count", () => {
    expect(ALL_NODE_KINDS.length).toBe(20);
  });

  it("number of EdgeKind values matches expected count", () => {
    expect(ALL_EDGE_KINDS.length).toBe(14);
  });
});
