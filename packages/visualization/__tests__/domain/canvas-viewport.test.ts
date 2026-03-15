import assert from "node:assert";
import { describe, it } from "node:test";
import {
  createCanvasViewport,
  updateCanvasViewport,
  type CanvasViewport,
} from "../../src/domain/index.js";

describe("CanvasViewport", () => {
  it("creates viewport with default values", () => {
    const viewport = createCanvasViewport();

    assert.strictEqual(viewport.x, 0);
    assert.strictEqual(viewport.y, 0);
    assert.strictEqual(viewport.zoom, 1);
  });

  it("creates viewport with custom values", () => {
    const viewport = createCanvasViewport(100, 200, 1.5);

    assert.strictEqual(viewport.x, 100);
    assert.strictEqual(viewport.y, 200);
    assert.strictEqual(viewport.zoom, 1.5);
  });

  it("updateCanvasViewport updates x and y", () => {
    const original = createCanvasViewport(0, 0, 1);
    const updated = updateCanvasViewport(original, { x: 50, y: 75 });

    assert.strictEqual(updated.x, 50);
    assert.strictEqual(updated.y, 75);
    assert.strictEqual(updated.zoom, 1);
  });

  it("updateCanvasViewport clamps zoom to minimum 0.1", () => {
    const original = createCanvasViewport(0, 0, 1);
    const updated = updateCanvasViewport(original, { zoom: 0.01 });

    assert.strictEqual(updated.zoom, 0.1);
  });

  it("updateCanvasViewport clamps zoom to maximum 2.0", () => {
    const original = createCanvasViewport(0, 0, 1);
    const updated = updateCanvasViewport(original, { zoom: 5 });

    assert.strictEqual(updated.zoom, 2.0);
  });

  it("updateCanvasViewport preserves zoom when not provided", () => {
    const original = createCanvasViewport(0, 0, 1.5);
    const updated = updateCanvasViewport(original, { x: 100 });

    assert.strictEqual(updated.zoom, 1.5);
  });

  it("original viewport is not mutated", () => {
    const original = createCanvasViewport(0, 0, 1);
    updateCanvasViewport(original, { x: 100, y: 100, zoom: 2 });

    assert.strictEqual(original.x, 0);
    assert.strictEqual(original.y, 0);
    assert.strictEqual(original.zoom, 1);
  });

  it("viewport has correct type", () => {
    const viewport: CanvasViewport = createCanvasViewport(10, 20, 0.5);

    assert.strictEqual(typeof viewport.x, "number");
    assert.strictEqual(typeof viewport.y, "number");
    assert.strictEqual(typeof viewport.zoom, "number");
  });
});
