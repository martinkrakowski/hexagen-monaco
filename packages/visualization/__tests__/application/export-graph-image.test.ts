import assert from "node:assert";
import { describe, it } from "vitest";
import { ExportGraphImageUseCase } from "../../src/application/use-cases/index.js";

describe("ExportGraphImageUseCase", () => {
  it("returns failure result when viewport element not found", async () => {
    const useCase = new ExportGraphImageUseCase();
    const input = {
      format: "png" as const,
      viewportSelector: ".nonexistent-selector",
    };

    const result = await useCase.exportImage(input);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error instanceof Error, true);
  });

  it("accepts format options", async () => {
    const useCase = new ExportGraphImageUseCase();
    const formats = ["png", "jpg", "svg"] as const;

    for (const format of formats) {
      const result = await useCase.exportImage({
        format,
        viewportSelector: ".react-flow__viewport",
      });

      assert.strictEqual("success" in result, true);
    }
  });

  it("returns Result type with correct shape", async () => {
    const useCase = new ExportGraphImageUseCase();
    const result = await useCase.exportImage({
      format: "png" as const,
      viewportSelector: ".react-flow__viewport",
    });

    assert.strictEqual("success" in result, true);
  });

  it("handles optional backgroundColor", async () => {
    const useCase = new ExportGraphImageUseCase();
    const result = await useCase.exportImage({
      format: "png" as const,
      viewportSelector: ".react-flow__viewport",
      backgroundColor: "#ffffff",
    });

    assert.strictEqual("success" in result, true);
  });
});
