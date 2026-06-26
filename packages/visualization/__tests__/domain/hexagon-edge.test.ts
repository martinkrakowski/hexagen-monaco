import assert from "node:assert";
import { describe, it } from "vitest";
import { createHexagonEdge, type HexagonEdge } from "../../src/domain/index.js";

describe("HexagonEdge", () => {
  it("creates an edge with all properties", () => {
    const edge = createHexagonEdge(
      "edge-1",
      "node-a",
      "node-b",
      "default",
      "flows to",
    );

    assert.strictEqual(edge.id, "edge-1");
    assert.strictEqual(edge.source, "node-a");
    assert.strictEqual(edge.target, "node-b");
    assert.strictEqual(edge.type, "default");
    assert.strictEqual(edge.label, "flows to");
  });

  it("creates an edge with default type", () => {
    const edge = createHexagonEdge("edge-2", "source", "target");

    assert.strictEqual(edge.id, "edge-2");
    assert.strictEqual(edge.source, "source");
    assert.strictEqual(edge.target, "target");
    assert.strictEqual(edge.type, "default");
    assert.strictEqual(edge.label, undefined);
  });

  it("creates an animated edge", () => {
    const edge = createHexagonEdge("edge-3", "a", "b", "animated");

    assert.strictEqual(edge.type, "animated");
  });

  it("edge has correct structure", () => {
    const edge: HexagonEdge = createHexagonEdge("e1", "s", "t");

    assert.strictEqual(typeof edge.id, "string");
    assert.strictEqual(typeof edge.source, "string");
    assert.strictEqual(typeof edge.target, "string");
    assert.strictEqual(
      edge.type === "default" || edge.type === "animated",
      true,
    );
  });
});
