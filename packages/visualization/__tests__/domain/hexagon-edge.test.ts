import assert from "node:assert";
import { describe, it } from "vitest";
import { createHexagonEdge, type HexagonEdge } from "../../src/domain/index.js";

/**
 * Three of the four cases this file used to hold were about `type`
 * ("creates an edge with default type", "creates an animated edge", and an
 * "edge has correct structure" case whose only real assertion was
 * `edge.type === "default" || edge.type === "animated"` — true by construction
 * given the factory's own default). `type` was `EdgeType`, whose members are
 * React Flow edge-path renderer ids; HEX-030 moved it to
 * `HexagonEdgePresentation`. They are deleted rather than ported: they asserted
 * a renderer default, not a domain rule, and the "correct structure" one passed
 * for a reason other than the one it named.
 */
describe("HexagonEdge", () => {
  it("creates an edge with all properties", () => {
    const edge = createHexagonEdge("edge-1", "node-a", "node-b", "flows to");

    assert.strictEqual(edge.id, "edge-1");
    assert.strictEqual(edge.source, "node-a");
    assert.strictEqual(edge.target, "node-b");
    assert.strictEqual(edge.label, "flows to");
  });

  it("creates an edge without a label", () => {
    const edge = createHexagonEdge("edge-2", "source", "target");

    assert.strictEqual(edge.id, "edge-2");
    assert.strictEqual(edge.source, "source");
    assert.strictEqual(edge.target, "target");
    assert.strictEqual(edge.label, undefined);
  });

  it("carries no renderer instructions of its own", () => {
    const edge: HexagonEdge = createHexagonEdge("e1", "s", "t");

    // Enumerable-key assertion rather than `assert.ok(!("style" in edge))`:
    // it fails when *any* unexpected key appears, not only the ones named.
    assert.deepStrictEqual(Object.keys(edge).sort(), [
      "id",
      "label",
      "source",
      "target",
    ]);
  });
});
