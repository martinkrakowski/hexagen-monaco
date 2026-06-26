import assert from "node:assert";
import { describe, it } from "vitest";
import {
  createHexagonNode,
  updateHexagonNodePosition,
  updateHexagonNodeLabel,
} from "../../src/domain/index.js";

describe("HexagonNode", () => {
  it("creates a node with all properties", () => {
    const node = createHexagonNode(
      "node-1",
      "Test Node",
      "bounded-context",
      { x: 100, y: 200 },
      "context-1",
    );

    assert.strictEqual(node.id, "node-1");
    assert.strictEqual(node.label, "Test Node");
    assert.strictEqual(node.type, "bounded-context");
    assert.deepStrictEqual(node.position, { x: 100, y: 200 });
    assert.strictEqual(node.boundedContextId, "context-1");
  });

  it("creates a node without boundedContextId", () => {
    const node = createHexagonNode("node-2", "Entity", "entity", {
      x: 0,
      y: 0,
    });

    assert.strictEqual(node.id, "node-2");
    assert.strictEqual(node.type, "entity");
    assert.strictEqual(node.boundedContextId, undefined);
  });

  it("updateHexagonNodePosition returns new node with updated position", () => {
    const original = createHexagonNode("node-1", "Test", "port", {
      x: 10,
      y: 20,
    });
    const updated = updateHexagonNodePosition(original, { x: 50, y: 60 });

    assert.deepStrictEqual(updated.position, { x: 50, y: 60 });
    assert.strictEqual(updated.id, original.id);
    assert.strictEqual(updated.label, original.label);
  });

  it("updateHexagonNodeLabel returns new node with updated label", () => {
    const original = createHexagonNode("node-1", "Old", "use-case", {
      x: 0,
      y: 0,
    });
    const updated = updateHexagonNodeLabel(original, "New Label");

    assert.strictEqual(updated.label, "New Label");
    assert.strictEqual(updated.id, original.id);
    assert.strictEqual(updated.type, original.type);
  });

  it("original node is not mutated by position update", () => {
    const original = createHexagonNode("node-1", "Test", "entity", {
      x: 10,
      y: 20,
    });
    updateHexagonNodePosition(original, { x: 100, y: 200 });

    assert.deepStrictEqual(original.position, { x: 10, y: 20 });
  });

  it("original node is not mutated by label update", () => {
    const original = createHexagonNode("node-1", "Test", "entity", {
      x: 0,
      y: 0,
    });
    updateHexagonNodeLabel(original, "New");

    assert.strictEqual(original.label, "Test");
  });
});
