import { TopologyChecker } from "../src/topology-checker.js";
import { NodeKind, EdgeKind } from "@hexagen/core-domain";
import type { DomainAST } from "@hexagen/core-domain";

describe("TopologyChecker", () => {
  let checker: TopologyChecker;

  beforeEach(() => {
    checker = new TopologyChecker();
  });

  describe("check()", () => {
    it("should return valid result for empty AST", () => {
      const ast: DomainAST = {
        nodes: [],
        edges: [],
        invariants: {
          topology: [],
          cardinality: [],
        },
      };

      const result = checker.check(ast);

      expect(result.valid).toBe(true);
      expect(result.violations).toEqual([]);
    });

    it("should detect self-loop edge as invalid", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "node1", kind: NodeKind.Entity, attributes: {} },
        ],
        edges: [
          { id: "edge1", kind: EdgeKind.Dependency, source: "node1", target: "node1", attributes: {} },
        ],
        invariants: {
          topology: [],
          cardinality: [],
        },
      };

      const result = checker.check(ast);

      expect(result.valid).toBe(false);
      expect(result.violations.length).toBe(1);
      expect(result.violations[0].type).toBe("Acyclic");
    });

    it("should detect disconnected nodes as invalid", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "node1", kind: NodeKind.Entity, attributes: {} },
          { id: "node2", kind: NodeKind.ValueObject, attributes: {} },
        ],
        edges: [],
        invariants: {
          topology: [],
          cardinality: [],
        },
      };

      const result = checker.check(ast);

      expect(result.valid).toBe(false);
      expect(result.violations.length).toBe(1);
      expect(result.violations[0].type).toBe("Connected");
    });

    it("should return valid result for properly connected graph", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "node1", kind: NodeKind.Entity, attributes: {} },
          { id: "node2", kind: NodeKind.ValueObject, attributes: {} },
        ],
        edges: [
          { id: "edge1", kind: EdgeKind.Dependency, source: "node1", target: "node2", attributes: {} },
        ],
        invariants: {
          topology: [],
          cardinality: [],
        },
      };

      const result = checker.check(ast);

      expect(result.valid).toBe(true);
      expect(result.violations).toEqual([]);
    });
  });
});