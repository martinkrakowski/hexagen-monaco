import assert from "node:assert";
import { describe, it } from "node:test";
import { ExportGraphImageUseCase } from "../../src/application/use-cases/index.js";

describe("ExportGraphImageUseCase", () => {
  it("returns failure result with error message", async () => {
    const useCase = new ExportGraphImageUseCase();
    const input = {
      format: "png" as const,
      width: 800,
      height: 600,
    };

    const result = await useCase.exportImage(input);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error instanceof Error, true);
    assert.strictEqual(result.error.message, "Export not yet implemented");
  });

  it("accepts format options", async () => {
    const useCase = new ExportGraphImageUseCase();
    const formats = ["png", "jpg", "svg"] as const;

    for (const format of formats) {
      const result = await useCase.exportImage({
        format,
        width: 100,
        height: 100,
      });

      assert.strictEqual(result.success, false);
    }
  });

  it("returns Result type with correct shape", async () => {
    const useCase = new ExportGraphImageUseCase();
    const result = await useCase.exportImage({
      format: "png" as const,
      width: 800,
      height: 600,
    });

    assert.strictEqual("success" in result, true);
    assert.strictEqual("error" in result, true);
  });

  it("handles optional backgroundColor", async () => {
    const useCase = new ExportGraphImageUseCase();
    const result = await useCase.exportImage({
      format: "png" as const,
      width: 800,
      height: 600,
      backgroundColor: "#ffffff",
    });

    assert.strictEqual(result.success, false);
  });
});
