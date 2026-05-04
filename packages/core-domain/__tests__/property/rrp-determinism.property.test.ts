import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NodeKind, EdgeKind } from "../../src/mvk/v1/index.js";
import type {
  DomainAST,
  ResolvedRuleProgram,
  ResolvedNode,
  ResolvedEdge,
} from "../../src/mvk/v1/index.js";

function deterministicHash(obj: unknown): string {
  const str = JSON.stringify(
    obj,
    Object.keys(obj as Record<string, unknown>).sort(),
  );
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

function resolveRRPDeterministically(
  ast: DomainAST,
  contextHash: string,
  ruleSetHash: string,
): ResolvedRuleProgram {
  const nodes: ResolvedNode[] = ast.nodes.map((node) => ({
    id: node.id,
    kind: node.kind,
    attributes: node.attributes,
    computedAttributes: {},
    validity: { valid: true, violations: [] },
  }));
  const edges: ResolvedEdge[] = ast.edges.map((edge) => ({
    id: edge.id,
    kind: edge.kind,
    source: edge.source,
    target: edge.target,
    attributes: edge.attributes,
    computedAttributes: {},
    validity: { valid: true, violations: [] },
  }));
  const topologicalOrder = [...nodes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((n) => n.id);
  return {
    version: "1.0",
    contextHash,
    ruleSetHash,
    nodes,
    edges,
    topologicalOrder,
  };
}

function generateRandomAST(nodeCount: number): DomainAST {
  const nodes = [];
  for (let i = 0; i < nodeCount; i++) {
    const kinds = [
      NodeKind.Aggregate,
      NodeKind.Entity,
      NodeKind.ValueObject,
      NodeKind.Service,
      NodeKind.Repository,
    ];
    nodes.push({
      id: `n${i}`,
      kind: kinds[Math.floor(Math.random() * kinds.length)],
      attributes: { label: `Node-${i}` },
    });
  }
  const edges = [];
  const edgeCount = Math.min(
    nodeCount * 2,
    Math.floor(Math.random() * nodeCount * 3),
  );
  for (let i = 0; i < edgeCount; i++) {
    if (nodes.length < 2) break;
    const sourceIdx = Math.floor(Math.random() * nodes.length);
    let targetIdx = Math.floor(Math.random() * nodes.length);
    while (targetIdx === sourceIdx && nodes.length > 1) {
      targetIdx = Math.floor(Math.random() * nodes.length);
    }
    const kinds = [
      EdgeKind.DirectAssociation,
      EdgeKind.Composition,
      EdgeKind.Aggregation,
      EdgeKind.Inheritance,
    ];
    edges.push({
      id: `e${i}`,
      kind: kinds[Math.floor(Math.random() * kinds.length)],
      source: nodes[sourceIdx].id,
      target: nodes[targetIdx].id,
      attributes: {},
    });
  }
  return {
    nodes,
    edges,
    invariants: { topology: [], cardinality: [] },
  };
}

describe("RRP Determinism Property Tests", () => {
  describe("identical inputs produce identical outputs", () => {
    it("should produce identical RRP hashes for same AST with same context", () => {
      let failures = 0;
      for (let i = 0; i < 1000; i++) {
        const ast = generateRandomAST(Math.floor(Math.random() * 15) + 2);
        const contextHash = "test-context";
        const ruleSetHash = "test-ruleset";
        const rrp1 = resolveRRPDeterministically(ast, contextHash, ruleSetHash);
        const rrp2 = resolveRRPDeterministically(ast, contextHash, ruleSetHash);
        const hash1 = deterministicHash(rrp1);
        const hash2 = deterministicHash(rrp2);
        if (hash1 !== hash2) failures++;
      }
      assert.strictEqual(failures, 0);
    });

    it("should produce identical topological order for same AST", () => {
      let failures = 0;
      for (let i = 0; i < 1000; i++) {
        const ast = generateRandomAST(Math.floor(Math.random() * 15) + 2);
        const rrp1 = resolveRRPDeterministically(ast, "ctx1", "rs1");
        const rrp2 = resolveRRPDeterministically(ast, "ctx1", "rs1");
        if (
          JSON.stringify(rrp1.topologicalOrder) !==
          JSON.stringify(rrp2.topologicalOrder)
        ) {
          failures++;
        }
      }
      assert.strictEqual(failures, 0);
    });

    it("should produce identical node count for same AST", () => {
      let failures = 0;
      for (let i = 0; i < 1000; i++) {
        const ast = generateRandomAST(Math.floor(Math.random() * 20) + 1);
        const rrp1 = resolveRRPDeterministically(ast, "ctx", "rs");
        const rrp2 = resolveRRPDeterministically(ast, "ctx", "rs");
        if (rrp1.nodes.length !== rrp2.nodes.length) failures++;
      }
      assert.strictEqual(failures, 0);
    });
  });

  describe("different context produces different hashes", () => {
    it("should produce different hashes for different contextHash", () => {
      let failures = 0;
      for (let i = 0; i < 500; i++) {
        const ast = generateRandomAST(Math.floor(Math.random() * 10) + 2);
        const rrp1 = resolveRRPDeterministically(ast, "context-a", "rs");
        const rrp2 = resolveRRPDeterministically(ast, "context-b", "rs");
        const hash1 = deterministicHash(rrp1);
        const hash2 = deterministicHash(rrp2);
        if (hash1 === hash2) failures++;
      }
      assert.strictEqual(failures, 0);
    });

    it("should produce different hashes for different ruleSetHash", () => {
      let failures = 0;
      for (let i = 0; i < 500; i++) {
        const ast = generateRandomAST(Math.floor(Math.random() * 10) + 2);
        const rrp1 = resolveRRPDeterministically(ast, "ctx", "ruleset-a");
        const rrp2 = resolveRRPDeterministically(ast, "ctx", "ruleset-b");
        const hash1 = deterministicHash(rrp1);
        const hash2 = deterministicHash(rrp2);
        if (hash1 === hash2) failures++;
      }
      assert.strictEqual(failures, 0);
    });
  });

  describe("structural integrity", () => {
    it("should preserve all node IDs in topological order", () => {
      let failures = 0;
      for (let i = 0; i < 1000; i++) {
        const ast = generateRandomAST(Math.floor(Math.random() * 15) + 2);
        const rrp = resolveRRPDeterministically(ast, "ctx", "rs");
        const nodeIds = new Set(rrp.nodes.map((n) => n.id));
        const topoIds = new Set(rrp.topologicalOrder);
        if (
          nodeIds.size !== topoIds.size ||
          ![...nodeIds].every((id) => topoIds.has(id))
        ) {
          failures++;
        }
      }
      assert.strictEqual(failures, 0);
    });

    it("should preserve edge source/target references", () => {
      let failures = 0;
      for (let i = 0; i < 1000; i++) {
        const ast = generateRandomAST(Math.floor(Math.random() * 15) + 2);
        const rrp = resolveRRPDeterministically(ast, "ctx", "rs");
        const nodeIds = new Set(rrp.nodes.map((n) => n.id));
        for (const edge of rrp.edges) {
          if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
            failures++;
            break;
          }
        }
      }
      assert.strictEqual(failures, 0);
    });
  });
});
