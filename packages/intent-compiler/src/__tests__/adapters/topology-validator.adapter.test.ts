import { TopologyValidatorAdapter } from "../../infrastructure/adapters/topology-validator.adapter.js";
import type { DomainAST } from "@hexagen/core-domain";

describe("TopologyValidatorAdapter", () => {
  let adapter: TopologyValidatorAdapter;

  beforeEach(() => {
    adapter = new TopologyValidatorAdapter();
  });

  describe("Acyclic invariant", () => {
    it("should pass for acyclic graph", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "n1", kind: "Entity", attributes: {} },
          { id: "n2", kind: "Entity", attributes: {} },
          { id: "n3", kind: "Entity", attributes: {} },
        ],
        edges: [
          {
            id: "e1",
            kind: "HasMany",
            source: "n1",
            target: "n2",
            attributes: {},
          },
          {
            id: "e2",
            kind: "HasMany",
            source: "n2",
            target: "n3",
            attributes: {},
          },
        ],
        invariants: {
          topology: [{ type: "Acyclic", payload: { appliesTo: ["HasMany"] } }],
          cardinality: [],
        },
      };

      const result = adapter.check(ast);

      expect(result.isValid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("should fail for cyclic graph", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "n1", kind: "Entity", attributes: {} },
          { id: "n2", kind: "Entity", attributes: {} },
        ],
        edges: [
          {
            id: "e1",
            kind: "HasMany",
            source: "n1",
            target: "n2",
            attributes: {},
          },
          {
            id: "e2",
            kind: "HasMany",
            source: "n2",
            target: "n1",
            attributes: {},
          },
        ],
        invariants: {
          topology: [{ type: "Acyclic", payload: { appliesTo: ["HasMany"] } }],
          cardinality: [],
        },
      };

      const result = adapter.check(ast);

      expect(result.isValid).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0]).toContain("Cycle detected");
    });

    it("should ignore edges not in appliesTo list", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "n1", kind: "Entity", attributes: {} },
          { id: "n2", kind: "Entity", attributes: {} },
        ],
        edges: [
          {
            id: "e1",
            kind: "HasMany",
            source: "n1",
            target: "n2",
            attributes: {},
          },
          {
            id: "e2",
            kind: "Other",
            source: "n2",
            target: "n1",
            attributes: {},
          },
        ],
        invariants: {
          topology: [{ type: "Acyclic", payload: { appliesTo: ["HasMany"] } }],
          cardinality: [],
        },
      };

      const result = adapter.check(ast);

      expect(result.isValid).toBe(true);
    });
  });

  describe("Containment invariant", () => {
    it("should pass when edges respect node type rules", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "n1", kind: "Entity", attributes: {} },
          { id: "n2", kind: "Property", attributes: {} },
        ],
        edges: [
          {
            id: "e1",
            kind: "HasProperty",
            source: "n1",
            target: "n2",
            attributes: {},
          },
        ],
        invariants: {
          topology: [
            {
              type: "Containment",
              payload: {
                source: "Entity",
                edgeKind: "HasProperty",
                target: "Property",
              },
            },
          ],
          cardinality: [],
        },
      };

      const result = adapter.check(ast);

      expect(result.isValid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("should fail when source node kind violates containment", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "n1", kind: "WrongKind", attributes: {} },
          { id: "n2", kind: "Property", attributes: {} },
        ],
        edges: [
          {
            id: "e1",
            kind: "HasProperty",
            source: "n1",
            target: "n2",
            attributes: {},
          },
        ],
        invariants: {
          topology: [
            {
              type: "Containment",
              payload: {
                source: "Entity",
                edgeKind: "HasProperty",
                target: "Property",
              },
            },
          ],
          cardinality: [],
        },
      };

      const result = adapter.check(ast);

      expect(result.isValid).toBe(false);
      expect(result.violations.some((v) => v.includes("source"))).toBe(true);
    });

    it("should fail when target node kind violates containment", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "n1", kind: "Entity", attributes: {} },
          { id: "n2", kind: "WrongKind", attributes: {} },
        ],
        edges: [
          {
            id: "e1",
            kind: "HasProperty",
            source: "n1",
            target: "n2",
            attributes: {},
          },
        ],
        invariants: {
          topology: [
            {
              type: "Containment",
              payload: {
                source: "Entity",
                edgeKind: "HasProperty",
                target: "Property",
              },
            },
          ],
          cardinality: [],
        },
      };

      const result = adapter.check(ast);

      expect(result.isValid).toBe(false);
      expect(result.violations.some((v) => v.includes("target"))).toBe(true);
    });
  });

  describe("DegreeConstraint invariant", () => {
    it("should pass when node edges meet constraints", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "n1", kind: "Entity", attributes: {} },
          { id: "n2", kind: "Entity", attributes: {} },
          { id: "n3", kind: "Entity", attributes: {} },
        ],
        edges: [
          {
            id: "e1",
            kind: "HasMany",
            source: "n1",
            target: "n2",
            attributes: {},
          },
          {
            id: "e2",
            kind: "HasMany",
            source: "n1",
            target: "n3",
            attributes: {},
          },
        ],
        invariants: {
          topology: [
            {
              type: "DegreeConstraint",
              payload: {
                edgeKind: "HasMany",
                min: 1,
                max: 5,
                appliesTo: [],
              },
            },
          ],
          cardinality: [],
        },
      };

      const result = adapter.check(ast);

      expect(result.isValid).toBe(true);
    });

    it("should fail when node has too few edges", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "n1", kind: "Entity", attributes: {} },
          { id: "n2", kind: "Entity", attributes: {} },
        ],
        edges: [],
        invariants: {
          topology: [
            {
              type: "DegreeConstraint",
              payload: {
                edgeKind: "HasMany",
                min: 1,
                max: 5,
                appliesTo: [],
              },
            },
          ],
          cardinality: [],
        },
      };

      const result = adapter.check(ast);

      expect(result.isValid).toBe(false);
      expect(result.violations.some((v) => v.includes("minimum"))).toBe(true);
    });

    it("should fail when node has too many edges", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "n1", kind: "Entity", attributes: {} },
          { id: "n2", kind: "Entity", attributes: {} },
          { id: "n3", kind: "Entity", attributes: {} },
          { id: "n4", kind: "Entity", attributes: {} },
        ],
        edges: [
          {
            id: "e1",
            kind: "HasMany",
            source: "n1",
            target: "n2",
            attributes: {},
          },
          {
            id: "e2",
            kind: "HasMany",
            source: "n1",
            target: "n3",
            attributes: {},
          },
          {
            id: "e3",
            kind: "HasMany",
            source: "n1",
            target: "n4",
            attributes: {},
          },
        ],
        invariants: {
          topology: [
            {
              type: "DegreeConstraint",
              payload: {
                edgeKind: "HasMany",
                min: 0,
                max: 2,
                appliesTo: [],
              },
            },
          ],
          cardinality: [],
        },
      };

      const result = adapter.check(ast);

      expect(result.isValid).toBe(false);
      expect(result.violations.some((v) => v.includes("maximum"))).toBe(true);
    });

    it("should filter by node kind when appliesTo is specified", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "n1", kind: "Entity", attributes: {} },
          { id: "n2", kind: "Property", attributes: {} },
          { id: "n3", kind: "Entity", attributes: {} },
        ],
        edges: [],
        invariants: {
          topology: [
            {
              type: "DegreeConstraint",
              payload: {
                edgeKind: "HasMany",
                min: 1,
                max: 5,
                appliesTo: ["Property"],
              },
            },
          ],
          cardinality: [],
        },
      };

      const result = adapter.check(ast);

      expect(result.isValid).toBe(false);
      expect(result.violations[0]).toContain("Property");
    });
  });

  describe("Connected invariant", () => {
    it("should pass for fully connected graph", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "n1", kind: "Entity", attributes: {} },
          { id: "n2", kind: "Entity", attributes: {} },
          { id: "n3", kind: "Entity", attributes: {} },
        ],
        edges: [
          {
            id: "e1",
            kind: "Link",
            source: "n1",
            target: "n2",
            attributes: {},
          },
          {
            id: "e2",
            kind: "Link",
            source: "n2",
            target: "n3",
            attributes: {},
          },
        ],
        invariants: {
          topology: [
            {
              type: "Connected",
              payload: { edgeKinds: ["Link"] },
            },
          ],
          cardinality: [],
        },
      };

      const result = adapter.check(ast);

      expect(result.isValid).toBe(true);
    });

    it("should fail for disconnected nodes", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "n1", kind: "Entity", attributes: {} },
          { id: "n2", kind: "Entity", attributes: {} },
          { id: "n3", kind: "Entity", attributes: {} },
        ],
        edges: [
          {
            id: "e1",
            kind: "Link",
            source: "n1",
            target: "n2",
            attributes: {},
          },
        ],
        invariants: {
          topology: [
            {
              type: "Connected",
              payload: { edgeKinds: ["Link"] },
            },
          ],
          cardinality: [],
        },
      };

      const result = adapter.check(ast);

      expect(result.isValid).toBe(false);
      expect(result.violations.some((v) => v.includes("not reachable"))).toBe(
        true,
      );
    });
  });

  describe("multiple invariants", () => {
    it("should validate all invariants", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "n1", kind: "Entity", attributes: {} },
          { id: "n2", kind: "Property", attributes: {} },
        ],
        edges: [
          {
            id: "e1",
            kind: "HasProperty",
            source: "n1",
            target: "n2",
            attributes: {},
          },
          {
            id: "e2",
            kind: "HasProperty",
            source: "n2",
            target: "n1",
            attributes: {},
          },
        ],
        invariants: {
          topology: [
            { type: "Acyclic", payload: { appliesTo: ["HasProperty"] } },
            {
              type: "Containment",
              payload: {
                source: "Entity",
                edgeKind: "HasProperty",
                target: "Property",
              },
            },
          ],
          cardinality: [],
        },
      };

      const result = adapter.check(ast);

      expect(result.isValid).toBe(false);
      expect(result.violations.length).toBeGreaterThan(1);
    });
  });

  describe("empty invariants", () => {
    it("should pass when no invariants are defined", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "n1", kind: "Entity", attributes: {} },
          { id: "n2", kind: "Entity", attributes: {} },
        ],
        edges: [
          {
            id: "e1",
            kind: "Link",
            source: "n1",
            target: "n2",
            attributes: {},
          },
          {
            id: "e2",
            kind: "Link",
            source: "n2",
            target: "n1",
            attributes: {},
          },
        ],
        invariants: {
          topology: [],
          cardinality: [],
        },
      };

      const result = adapter.check(ast);

      expect(result.isValid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("should pass for empty AST with no invariants", () => {
      const ast: DomainAST = {
        nodes: [],
        edges: [],
        invariants: {
          topology: [],
          cardinality: [],
        },
      };

      const result = adapter.check(ast);

      expect(result.isValid).toBe(true);
    });
  });
});
