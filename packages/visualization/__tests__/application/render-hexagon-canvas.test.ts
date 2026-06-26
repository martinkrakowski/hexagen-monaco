import assert from "node:assert";
import { describe, it } from "vitest";
import { RenderHexagonCanvasUseCase } from "../../src/application/use-cases/index.js";
import { createCanvasViewport } from "../../src/domain/index.js";

describe("RenderHexagonCanvasUseCase", () => {
  it("renders canvas with given nodes and edges", async () => {
    const useCase = new RenderHexagonCanvasUseCase();
    const input = {
      canvasId: "canvas-1",
      nodes: [],
      edges: [],
    };

    const result = await useCase.render(input);

    assert.strictEqual(result.canvasId, "canvas-1");
  });

  it("uses provided viewport", async () => {
    const useCase = new RenderHexagonCanvasUseCase();
    const customViewport = { x: 100, y: 200, zoom: 0.5 };
    const input = {
      canvasId: "canvas-1",
      nodes: [],
      edges: [],
      viewport: customViewport,
    };

    const result = await useCase.render(input);

    assert.strictEqual(result.viewport, customViewport);
  });

  it("creates default viewport when not provided", async () => {
    const useCase = new RenderHexagonCanvasUseCase();
    const input = {
      canvasId: "canvas-1",
      nodes: [],
      edges: [],
    };

    const result = await useCase.render(input);

    assert.deepStrictEqual(result.viewport, createCanvasViewport());
  });

  it("returns canvas id correctly", async () => {
    const useCase = new RenderHexagonCanvasUseCase();
    const input = {
      canvasId: "test-canvas-id",
      nodes: [],
      edges: [],
    };

    const result = await useCase.render(input);

    assert.strictEqual(result.canvasId, "test-canvas-id");
  });
});
