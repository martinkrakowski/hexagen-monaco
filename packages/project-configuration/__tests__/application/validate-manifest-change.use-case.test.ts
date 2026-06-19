import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ValidateManifestChangeUseCase } from "../../src/application/use-cases/validate-manifest-change.use-case";

describe("ValidateManifestChangeUseCase", () => {
  it("should accept a valid manifest proposal", () => {
    const useCase = new ValidateManifestChangeUseCase();

    const validResult = useCase.execute({
      system: "hexagen-monaco",
      bounded_contexts: [
        {
          name: "sync",
          type: "core",
          description: "Sync engine",
          layers: {},
        },
      ],
    });

    assert.strictEqual(validResult.valid, true);
    assert.deepStrictEqual(validResult.errors, []);
  });

  it("should reject an invalid manifest proposal", () => {
    const useCase = new ValidateManifestChangeUseCase();

    const invalidResult = useCase.execute({
      bounded_contexts: [
        {
          name: "sync",
          type: "invalid-type",
          description: "bad",
          layers: {},
        },
      ],
    });

    assert.strictEqual(invalidResult.valid, false);
    assert.ok(invalidResult.errors.length > 0);
  });
});
