import assert from "node:assert";
import { ValidateManifestChangeUseCase } from "../../src/application/use-cases/validate-manifest-change.use-case";

(() => {
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

  assert.strictEqual(
    validResult.valid,
    true,
    "should accept a valid manifest proposal",
  );
  assert.deepStrictEqual(validResult.errors, []);

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

  assert.strictEqual(
    invalidResult.valid,
    false,
    "should reject an invalid manifest proposal",
  );
  assert.ok(
    invalidResult.errors.length > 0,
    "should include validation errors",
  );

  console.log("✅ validate-manifest-change use case tests passed");
})();
