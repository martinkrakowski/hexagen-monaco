import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { ParseGestureUseCase } from "../../application/use-cases/parse-gesture.use-case.js";
import { Gesture } from "../../domain/gesture.js";
import { Rejection } from "../../domain/rejection.js";
import { ManifestAwareGestureParserAdapter } from "../../infrastructure/adapters/manifest-aware-gesture-parser.adapter.js";
import { TopologyValidatorAdapter } from "../../infrastructure/adapters/topology-validator.adapter.js";
import { CardinalityValidatorAdapter } from "../../infrastructure/adapters/cardinality-validator.adapter.js";
import { ConsoleRejectEmitterAdapter } from "../../infrastructure/adapters/console-reject-emitter.adapter.js";
import type { DomainAST } from "@hexagen/core-domain";

describe("ParseGestureUseCase Integration", () => {
  let useCase: ParseGestureUseCase;
  let errorSpy: ReturnType<typeof mock.method>;

  beforeEach(() => {
    const parser = new ManifestAwareGestureParserAdapter();
    const topologyChecker = new TopologyValidatorAdapter();
    const cardinalityChecker = new CardinalityValidatorAdapter();
    const rejectEmitter = new ConsoleRejectEmitterAdapter();

    useCase = new ParseGestureUseCase(
      parser,
      topologyChecker,
      cardinalityChecker,
      rejectEmitter,
    );

    errorSpy = mock.method(console, "error", () => {});
  });

  afterEach(() => {
    errorSpy.mock.restore();
  });

  describe("valid gesture parsing", () => {
    it("should return ParsedGesture for valid input with no invariants", () => {
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
        ],
        invariants: {
          topology: [],
          cardinality: [],
        },
      };

      const gesture = new Gesture("g1", "AddNodes", { ast });

      const result = useCase.execute(gesture);

      assert.strictEqual(result.gesture, gesture);
      assert.deepStrictEqual(result.ast, ast);
      assert.strictEqual(errorSpy.mock.calls.length, 0);
    });

    it("should pass all topology validations", () => {
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

      const gesture = new Gesture("g1", "AddNodes", { ast });

      const result = useCase.execute(gesture);

      assert.strictEqual(result.ast.nodes.length, 3);
      assert.strictEqual(errorSpy.mock.calls.length, 0);
    });

    it("should pass all cardinality validations", () => {
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

      const gesture = new Gesture("g1", "AddNodes", { ast });

      const result = useCase.execute(gesture);

      assert.strictEqual(result.ast.nodes.length, 2);
      assert.strictEqual(errorSpy.mock.calls.length, 0);
    });
  });

  describe("topology validation failures", () => {
    it("should throw Rejection for cyclic graph", () => {
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

      const gesture = new Gesture("g1", "AddNodes", { ast });

      assert.throws(() => useCase.execute(gesture));
      assert.ok(errorSpy.mock.calls.length > 0);
      const message = errorSpy.mock.calls[0].arguments[0] as string;
      assert.ok(message.includes("Topology validation failed"));
    });

    it("should emit rejection and preserve error message", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "n1", kind: "Entity", attributes: {} },
          { id: "n2", kind: "Property", attributes: {} },
        ],
        edges: [
          {
            id: "e1",
            kind: "HasProperty",
            source: "n2",
            target: "n1",
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

      const gesture = new Gesture("g1", "AddNodes", { ast });

      try {
        useCase.execute(gesture);
        fail("should have thrown");
      } catch (e) {
        const error = e as Error;
        assert.ok(error.message.includes("Topology validation failed"));
        assert.ok("reason" in error);
      }
    });
  });

  describe("cardinality validation failures", () => {
    it("should throw Rejection for cardinality violation", () => {
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
              payload: { nodeKind: "Entity", count: 3 },
            },
          ],
        },
      };

      const gesture = new Gesture("g1", "AddNodes", { ast });

      assert.throws(() => useCase.execute(gesture));
      assert.ok(errorSpy.mock.calls.length > 0);
      const message = errorSpy.mock.calls[0].arguments[0] as string;
      assert.ok(message.includes("Cardinality validation failed"));
    });
  });

  describe("complex validation scenarios", () => {
    it("should validate both topology and cardinality for valid AST", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "n1", kind: "Entity", attributes: {} },
          { id: "n2", kind: "Entity", attributes: {} },
          { id: "n3", kind: "Entity", attributes: {} },
          { id: "p1", kind: "Property", attributes: {} },
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
          {
            id: "e3",
            kind: "HasProperty",
            source: "n1",
            target: "p1",
            attributes: {},
          },
        ],
        invariants: {
          topology: [
            { type: "Acyclic", payload: { appliesTo: ["HasMany"] } },
            {
              type: "Containment",
              payload: {
                source: "Entity",
                edgeKind: "HasProperty",
                target: "Property",
              },
            },
          ],
          cardinality: [
            {
              type: "Exactly",
              payload: { nodeKind: "Entity", count: 3 },
            },
            {
              type: "AtLeast",
              payload: { nodeKind: "Property", count: 1 },
            },
          ],
        },
      };

      const gesture = new Gesture("g1", "ComplexAdd", { ast });

      const result = useCase.execute(gesture);

      assert.deepStrictEqual(result.ast, ast);
      assert.strictEqual(errorSpy.mock.calls.length, 0);
    });

    it("should fail on first validation error encountered", () => {
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
          cardinality: [
            {
              type: "Exactly",
              payload: { nodeKind: "Entity", count: 5 },
            },
          ],
        },
      };

      const gesture = new Gesture("g1", "FailOnTopology", { ast });

      try {
        useCase.execute(gesture);
        fail("should have thrown");
      } catch (e) {
        const rejection = e as Rejection;
        assert.ok(rejection.reason.includes("Topology validation failed"));
        assert.ok(!rejection.reason.includes("Cardinality"));
      }
    });
  });

  describe("edge cases", () => {
    it("should handle gesture with no AST payload", () => {
      const gesture = new Gesture("g1", "Empty", {});

      const result = useCase.execute(gesture);

      assert.deepStrictEqual(result.ast.nodes, []);
      assert.deepStrictEqual(result.ast.edges, []);
    });

    it("should handle AST with only nodes, no edges", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "n1", kind: "Entity", attributes: {} },
          { id: "n2", kind: "Entity", attributes: {} },
        ],
        edges: [],
        invariants: {
          topology: [],
          cardinality: [],
        },
      };

      const gesture = new Gesture("g1", "OnlyNodes", { ast });

      const result = useCase.execute(gesture);

      assert.strictEqual(result.ast.nodes.length, 2);
      assert.strictEqual(result.ast.edges.length, 0);
    });

    it("should handle AST with only edges, no nodes", () => {
      const ast: DomainAST = {
        nodes: [],
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
          topology: [],
          cardinality: [],
        },
      };

      const gesture = new Gesture("g1", "OnlyEdges", { ast });

      const result = useCase.execute(gesture);

      assert.strictEqual(result.ast.nodes.length, 0);
      assert.strictEqual(result.ast.edges.length, 1);
    });
  });
});
