import { Gesture } from "../../domain/gesture.js";
import { ManifestAwareGestureParserAdapter } from "../../infrastructure/adapters/manifest-aware-gesture-parser.adapter.js";
import type { DomainAST } from "@hexagen/core-domain";

describe("ManifestAwareGestureParserAdapter", () => {
  let adapter: ManifestAwareGestureParserAdapter;

  beforeEach(() => {
    adapter = new ManifestAwareGestureParserAdapter();
  });

  describe("parse", () => {
    it("should parse a gesture with full AST payload", () => {
      const ast: DomainAST = {
        nodes: [
          {
            id: "node1",
            kind: "Entity",
            attributes: { name: "User" },
          },
        ],
        edges: [],
        invariants: {
          topology: [],
          cardinality: [],
        },
      };

      const gesture = new Gesture("gesture1", "AddNode", { ast });

      const result = adapter.parse(gesture);

      expect(result.gesture).toBe(gesture);
      expect(result.ast).toEqual(ast);
      expect(result.confidence).toBeGreaterThan(0);
    });

    it("should construct AST from constituent parts", () => {
      const gesture = new Gesture("gesture1", "AddNodes", {
        nodes: [
          { id: "node1", kind: "Entity", attributes: { name: "User" } },
          { id: "node2", kind: "Entity", attributes: { name: "Post" } },
        ],
        edges: [
          {
            id: "edge1",
            kind: "HasMany",
            source: "node1",
            target: "node2",
            attributes: {},
          },
        ],
        invariants: {
          topology: [],
          cardinality: [],
        },
      });

      const result = adapter.parse(gesture);

      expect(result.ast.nodes).toHaveLength(2);
      expect(result.ast.edges).toHaveLength(1);
    });

    it("should handle empty payload gracefully", () => {
      const gesture = new Gesture("gesture1", "Empty", {});

      const result = adapter.parse(gesture);

      expect(result.ast.nodes).toEqual([]);
      expect(result.ast.edges).toEqual([]);
      expect(result.confidence).toBe(0);
    });

    it("should compute confidence based on payload completeness", () => {
      // Empty payload
      const empty = new Gesture("g1", "Empty", {});
      const emptyResult = adapter.parse(empty);
      expect(emptyResult.confidence).toBe(0);

      // Partial payload (nodes only)
      const partial = new Gesture("g2", "Partial", {
        nodes: [{ id: "n1", kind: "Entity", attributes: {} }],
      });
      const partialResult = adapter.parse(partial);
      expect(partialResult.confidence).toBeGreaterThan(0);
      expect(partialResult.confidence).toBeLessThan(1);

      // Full AST payload
      const full = new Gesture("g3", "Full", {
        ast: {
          nodes: [{ id: "n1", kind: "Entity", attributes: {} }],
          edges: [],
          invariants: { topology: [], cardinality: [] },
        },
      });
      const fullResult = adapter.parse(full);
      expect(fullResult.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it("should preserve gesture metadata in result", () => {
      const gesture = new Gesture("gesture1", "TestType", {}, "lineage/path");

      const result = adapter.parse(gesture);

      expect(result.gesture.id).toBe("gesture1");
      expect(result.gesture.type).toBe("TestType");
      expect(result.gesture.lineage).toBe("lineage/path");
    });
  });

  describe("confidence computation", () => {
    it("should return 0 for null payload", () => {
      const gesture = new Gesture("g1", "Test", null);

      const result = adapter.parse(gesture);

      expect(result.confidence).toBe(0);
    });

    it("should award points for AST presence", () => {
      const withAst = new Gesture("g1", "Test", {
        ast: {
          nodes: [],
          edges: [],
          invariants: { topology: [], cardinality: [] },
        },
      });

      const result = adapter.parse(withAst);

      expect(result.confidence).toBeGreaterThan(0.3);
    });

    it("should award points for nodes and edges", () => {
      const withNodes = new Gesture("g1", "Test", {
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
      });

      const result = adapter.parse(withNodes);

      expect(result.confidence).toBeGreaterThan(0.2);
    });

    it("should award points for invariants", () => {
      const withInvariants = new Gesture("g1", "Test", {
        invariants: {
          topology: [{ type: "Acyclic", payload: { appliesTo: ["Link"] } }],
          cardinality: [],
        },
      });

      const result = adapter.parse(withInvariants);

      expect(result.confidence).toBeGreaterThan(0);
    });
  });
});
