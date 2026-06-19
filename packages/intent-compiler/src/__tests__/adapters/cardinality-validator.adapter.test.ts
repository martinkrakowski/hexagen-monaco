import assert from "node:assert/strict";
import { describe, it, beforeEach } from "vitest";
import { CardinalityValidatorAdapter } from "../../infrastructure/adapters/cardinality-validator.adapter.js";
import type { DomainAST } from "@hexagen/core-domain";

describe("CardinalityValidatorAdapter", () => {
  let adapter: CardinalityValidatorAdapter;

  beforeEach(() => {
    adapter = new CardinalityValidatorAdapter();
  });

  describe("Exactly invariant", () => {
    it("should pass when node count matches exactly", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "n1", kind: "Entity", attributes: {} },
          { id: "n2", kind: "Entity", attributes: {} },
        ],
        edges: [],
        invariants: {
          topology: [],
          cardinality: [
            {
              type: "Exactly",
              payload: { nodeKind: "Entity", count: 2 },
            },
          ],
        },
      };

      const result = adapter.check(ast);

      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.violations.length, 0);
    });

    it("should fail when node count is less than expected", () => {
      const ast: DomainAST = {
        nodes: [{ id: "n1", kind: "Entity", attributes: {} }],
        edges: [],
        invariants: {
          topology: [],
          cardinality: [
            {
              type: "Exactly",
              payload: { nodeKind: "Entity", count: 2 },
            },
          ],
        },
      };

      const result = adapter.check(ast);

      assert.strictEqual(result.isValid, false);
      assert.ok(result.violations[0].includes("has 1 instances"));
      assert.ok(result.violations[0].includes("expected exactly 2"));
    });

    it("should fail when node count is greater than expected", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "n1", kind: "Entity", attributes: {} },
          { id: "n2", kind: "Entity", attributes: {} },
          { id: "n3", kind: "Entity", attributes: {} },
        ],
        edges: [],
        invariants: {
          topology: [],
          cardinality: [
            {
              type: "Exactly",
              payload: { nodeKind: "Entity", count: 2 },
            },
          ],
        },
      };

      const result = adapter.check(ast);

      assert.strictEqual(result.isValid, false);
      assert.ok(result.violations[0].includes("has 3 instances"));
    });
  });

  describe("AtLeast invariant", () => {
    it("should pass when node count meets minimum", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "n1", kind: "Entity", attributes: {} },
          { id: "n2", kind: "Entity", attributes: {} },
        ],
        edges: [],
        invariants: {
          topology: [],
          cardinality: [
            {
              type: "AtLeast",
              payload: { nodeKind: "Entity", count: 2 },
            },
          ],
        },
      };

      const result = adapter.check(ast);

      assert.strictEqual(result.isValid, true);
    });

    it("should pass when node count exceeds minimum", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "n1", kind: "Entity", attributes: {} },
          { id: "n2", kind: "Entity", attributes: {} },
          { id: "n3", kind: "Entity", attributes: {} },
        ],
        edges: [],
        invariants: {
          topology: [],
          cardinality: [
            {
              type: "AtLeast",
              payload: { nodeKind: "Entity", count: 2 },
            },
          ],
        },
      };

      const result = adapter.check(ast);

      assert.strictEqual(result.isValid, true);
    });

    it("should fail when node count is below minimum", () => {
      const ast: DomainAST = {
        nodes: [{ id: "n1", kind: "Entity", attributes: {} }],
        edges: [],
        invariants: {
          topology: [],
          cardinality: [
            {
              type: "AtLeast",
              payload: { nodeKind: "Entity", count: 2 },
            },
          ],
        },
      };

      const result = adapter.check(ast);

      assert.strictEqual(result.isValid, false);
      assert.ok(result.violations[0].includes("at least"));
    });
  });

  describe("AtMost invariant", () => {
    it("should pass when node count meets maximum", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "n1", kind: "Entity", attributes: {} },
          { id: "n2", kind: "Entity", attributes: {} },
        ],
        edges: [],
        invariants: {
          topology: [],
          cardinality: [
            {
              type: "AtMost",
              payload: { nodeKind: "Entity", count: 2 },
            },
          ],
        },
      };

      const result = adapter.check(ast);

      assert.strictEqual(result.isValid, true);
    });

    it("should pass when node count is below maximum", () => {
      const ast: DomainAST = {
        nodes: [{ id: "n1", kind: "Entity", attributes: {} }],
        edges: [],
        invariants: {
          topology: [],
          cardinality: [
            {
              type: "AtMost",
              payload: { nodeKind: "Entity", count: 2 },
            },
          ],
        },
      };

      const result = adapter.check(ast);

      assert.strictEqual(result.isValid, true);
    });

    it("should fail when node count exceeds maximum", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "n1", kind: "Entity", attributes: {} },
          { id: "n2", kind: "Entity", attributes: {} },
          { id: "n3", kind: "Entity", attributes: {} },
        ],
        edges: [],
        invariants: {
          topology: [],
          cardinality: [
            {
              type: "AtMost",
              payload: { nodeKind: "Entity", count: 2 },
            },
          ],
        },
      };

      const result = adapter.check(ast);

      assert.strictEqual(result.isValid, false);
      assert.ok(result.violations[0].includes("at most"));
    });
  });

  describe("Between invariant", () => {
    it("should pass when node count is within range", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "n1", kind: "Entity", attributes: {} },
          { id: "n2", kind: "Entity", attributes: {} },
        ],
        edges: [],
        invariants: {
          topology: [],
          cardinality: [
            {
              type: "Between",
              payload: { nodeKind: "Entity", min: 1, max: 3 },
            },
          ],
        },
      };

      const result = adapter.check(ast);

      assert.strictEqual(result.isValid, true);
    });

    it("should pass when node count equals min", () => {
      const ast: DomainAST = {
        nodes: [{ id: "n1", kind: "Entity", attributes: {} }],
        edges: [],
        invariants: {
          topology: [],
          cardinality: [
            {
              type: "Between",
              payload: { nodeKind: "Entity", min: 1, max: 3 },
            },
          ],
        },
      };

      const result = adapter.check(ast);

      assert.strictEqual(result.isValid, true);
    });

    it("should pass when node count equals max", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "n1", kind: "Entity", attributes: {} },
          { id: "n2", kind: "Entity", attributes: {} },
          { id: "n3", kind: "Entity", attributes: {} },
        ],
        edges: [],
        invariants: {
          topology: [],
          cardinality: [
            {
              type: "Between",
              payload: { nodeKind: "Entity", min: 1, max: 3 },
            },
          ],
        },
      };

      const result = adapter.check(ast);

      assert.strictEqual(result.isValid, true);
    });

    it("should fail when node count is below min", () => {
      const ast: DomainAST = {
        nodes: [],
        edges: [],
        invariants: {
          topology: [],
          cardinality: [
            {
              type: "Between",
              payload: { nodeKind: "Entity", min: 1, max: 3 },
            },
          ],
        },
      };

      const result = adapter.check(ast);

      assert.strictEqual(result.isValid, false);
      assert.ok(result.violations[0].includes("between"));
    });

    it("should fail when node count is above max", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "n1", kind: "Entity", attributes: {} },
          { id: "n2", kind: "Entity", attributes: {} },
          { id: "n3", kind: "Entity", attributes: {} },
          { id: "n4", kind: "Entity", attributes: {} },
        ],
        edges: [],
        invariants: {
          topology: [],
          cardinality: [
            {
              type: "Between",
              payload: { nodeKind: "Entity", min: 1, max: 3 },
            },
          ],
        },
      };

      const result = adapter.check(ast);

      assert.strictEqual(result.isValid, false);
    });
  });

  describe("multiple node kinds", () => {
    it("should validate invariants for different node kinds independently", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "n1", kind: "Entity", attributes: {} },
          { id: "n2", kind: "Entity", attributes: {} },
          { id: "p1", kind: "Property", attributes: {} },
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
              type: "Exactly",
              payload: { nodeKind: "Property", count: 1 },
            },
          ],
        },
      };

      const result = adapter.check(ast);

      assert.strictEqual(result.isValid, true);
    });

    it("should report violations for specific node kinds", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "n1", kind: "Entity", attributes: {} },
          { id: "p1", kind: "Property", attributes: {} },
          { id: "p2", kind: "Property", attributes: {} },
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
              type: "Exactly",
              payload: { nodeKind: "Property", count: 1 },
            },
          ],
        },
      };

      const result = adapter.check(ast);

      assert.strictEqual(result.isValid, false);
      assert.strictEqual(result.violations.length, 2);
    });
  });

  describe("non-existent node kinds", () => {
    it("should fail for exactly invariant on missing node kind", () => {
      const ast: DomainAST = {
        nodes: [],
        edges: [],
        invariants: {
          topology: [],
          cardinality: [
            {
              type: "Exactly",
              payload: { nodeKind: "Entity", count: 1 },
            },
          ],
        },
      };

      const result = adapter.check(ast);

      assert.strictEqual(result.isValid, false);
    });

    it("should pass for atleast invariant with count 0 on missing node kind", () => {
      const ast: DomainAST = {
        nodes: [],
        edges: [],
        invariants: {
          topology: [],
          cardinality: [
            {
              type: "AtLeast",
              payload: { nodeKind: "Entity", count: 0 },
            },
          ],
        },
      };

      const result = adapter.check(ast);

      assert.strictEqual(result.isValid, true);
    });
  });

  describe("empty invariants", () => {
    it("should pass when no cardinality invariants are defined", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "n1", kind: "Entity", attributes: {} },
          { id: "n2", kind: "Entity", attributes: {} },
          { id: "n3", kind: "Entity", attributes: {} },
        ],
        edges: [],
        invariants: {
          topology: [],
          cardinality: [],
        },
      };

      const result = adapter.check(ast);

      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.violations.length, 0);
    });
  });
});
