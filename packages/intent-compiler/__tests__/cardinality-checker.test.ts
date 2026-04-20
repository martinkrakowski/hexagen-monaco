import { CardinalityChecker } from "../src/cardinality-checker.js";
import { NodeKind } from "@hexagen/core-domain";
import type { DomainAST } from "@hexagen/core-domain";

describe("CardinalityChecker", () => {
  let checker: CardinalityChecker;

  beforeEach(() => {
    checker = new CardinalityChecker();
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

it("should detect Exactly invariant violation", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "node1", kind: NodeKind.Entity, attributes: {} },
          { id: "node2", kind: NodeKind.Entity, attributes: {} },
        ],
        edges: [],
        invariants: {
          topology: [],
          cardinality: [
            {
              type: "Exactly",
              payload: {
                nodeKind: "Entity",
                count: 1,
              },
            },
          ],
        },
      };

      const result = checker.check(ast);

      expect(result.valid).toBe(false);
      expect(result.violations.length).toBe(1);
      expect(result.violations[0].type).toBe("Exactly");
    });

    it("should detect AtLeast invariant violation", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "node1", kind: NodeKind.Entity, attributes: {} },
        ],
        edges: [],
        invariants: {
          topology: [],
          cardinality: [
            {
              type: "AtLeast",
              payload: {
                nodeKind: "Entity",
                count: 2,
              },
            },
          ],
        },
      };

      const result = checker.check(ast);

      expect(result.valid).toBe(false);
      expect(result.violations.length).toBe(1);
      expect(result.violations[0].type).toBe("AtLeast");
    });

    it("should detect AtMost invariant violation", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "node1", kind: NodeKind.Entity, attributes: {} },
          { id: "node2", kind: NodeKind.Entity, attributes: {} },
          { id: "node3", kind: NodeKind.Entity, attributes: {} },
        ],
        edges: [],
        invariants: {
          topology: [],
          cardinality: [
            {
              type: "AtMost",
              payload: {
                nodeKind: "Entity",
                count: 2,
              },
            },
          ],
        },
      };

      const result = checker.check(ast);

      expect(result.valid).toBe(false);
      expect(result.violations.length).toBe(1);
      expect(result.violations[0].type).toBe("AtMost");
    });

    it("should detect Between invariant violation", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "node1", kind: NodeKind.Entity, attributes: {} },
        ],
        edges: [],
        invariants: {
          topology: [],
          cardinality: [
            {
              type: "Between",
              payload: {
                nodeKind: "Entity",
                min: 2,
                max: 4,
              },
            },
          ],
        },
      };

      const result = checker.check(ast);

      expect(result.valid).toBe(false);
      expect(result.violations.length).toBe(1);
      expect(result.violations[0].type).toBe("Between");
    });

    it("should return valid result when all invariants are satisfied", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "node1", kind: NodeKind.Entity, attributes: {} },
          { id: "node2", kind: NodeKind.Entity, attributes: {} },
        ],
        edges: [],
        invariants: {
          topology: [],
          cardinality: [
            {
              type: "Exactly",
              payload: { nodeKind: "Entity", count: 2 },
            },
            {
              type: "AtLeast",
              payload: { nodeKind: "Entity", count: 1 },
            },
            {
              type: "AtMost",
              payload: { nodeKind: "Entity", count: 3 },
            },
            {
              type: "Between",
              payload: { nodeKind: "Entity", min: 1, max: 3 },
            },
          ],
        },
      };

      const result = checker.check(ast);

      expect(result.valid).toBe(true);
      expect(result.violations).toEqual([]);
    });

    it("should detect AtLeast invariant violation", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "node1", kind: "TestNode" as const, label: "A", properties: [] },
        ],
        edges: [],
        invariants: {
          topology: [],
          cardinality: [
            {
              type: "AtLeast",
              payload: {
                nodeKind: "TestNode",
                count: 2,
              },
            },
          ],
        },
      };

      const result = checker.check(ast);

      expect(result.valid).toBe(false);
      expect(result.violations.length).toBe(1);
      expect(result.violations[0].type).toBe("AtLeast");
    });

    it("should detect AtMost invariant violation", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "node1", kind: "TestNode" as const, label: "A", properties: [] },
          { id: "node2", kind: "TestNode" as const, label: "B", properties: [] },
          { id: "node3", kind: "TestNode" as const, label: "C", properties: [] },
        ],
        edges: [],
        invariants: {
          topology: [],
          cardinality: [
            {
              type: "AtMost",
              payload: {
                nodeKind: "TestNode",
                count: 2,
              },
            },
          ],
        },
      };

      const result = checker.check(ast);

      expect(result.valid).toBe(false);
      expect(result.violations.length).toBe(1);
      expect(result.violations[0].type).toBe("AtMost");
    });

    it("should detect Between invariant violation", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "node1", kind: "TestNode" as const, label: "A", properties: [] },
        ],
        edges: [],
        invariants: {
          topology: [],
          cardinality: [
            {
              type: "Between",
              payload: {
                nodeKind: "TestNode",
                min: 2,
                max: 4,
              },
            },
          ],
        },
      };

      const result = checker.check(ast);

      expect(result.valid).toBe(false);
      expect(result.violations.length).toBe(1);
      expect(result.violations[0].type).toBe("Between");
    });

    it("should return valid result when all invariants are satisfied", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "node1", kind: "TestNode" as const, label: "A", properties: [] },
          { id: "node2", kind: "TestNode" as const, label: "B", properties: [] },
        ],
        edges: [],
        invariants: {
          topology: [],
          cardinality: [
            {
              type: "Exactly",
              payload: { nodeKind: "TestNode", count: 2 },
            },
            {
              type: "AtLeast",
              payload: { nodeKind: "TestNode", count: 1 },
            },
            {
              type: "AtMost",
              payload: { nodeKind: "TestNode", count: 3 },
            },
            {
              type: "Between",
              payload: { nodeKind: "TestNode", min: 1, max: 3 },
            },
          ],
        },
      };

      const result = checker.check(ast);

      expect(result.valid).toBe(true);
      expect(result.violations).toEqual([]);
    });
  });
});