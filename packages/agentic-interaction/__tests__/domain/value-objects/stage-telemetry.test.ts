import { test, describe } from "node:test";
import * as assert from "node:assert/strict";
import {
  formatModelChip,
  modelNameFromResponseMetadata,
} from "../../../src/domain/value-objects/stage-telemetry";

describe("formatModelChip", () => {
  test("renders a single-model chip", () => {
    assert.strictEqual(
      formatModelChip({ modelName: "mercury-2" }),
      "[mercury-2]",
    );
  });

  test("renders a draft/refiner cascade chip", () => {
    assert.strictEqual(
      formatModelChip({ modelName: "mercury-2", refinerModelName: "gpt-4o" }),
      "[mercury-2 / gpt-4o]",
    );
  });

  test("returns null when no model was resolved", () => {
    assert.strictEqual(formatModelChip({}), null);
    assert.strictEqual(formatModelChip({ modelName: undefined }), null);
    // Empty string is "not resolved", not a chip.
    assert.strictEqual(formatModelChip({ modelName: "" }), null);
  });

  test("a refiner without a draft model renders no chip", () => {
    // Can't happen in practice (the refiner only runs after a successful
    // draft) but the formatter must not emit a half-empty chip.
    assert.strictEqual(formatModelChip({ refinerModelName: "gpt-4o" }), null);
  });
});

describe("modelNameFromResponseMetadata", () => {
  test("extracts the model recorded by the cloud adapters", () => {
    assert.strictEqual(
      modelNameFromResponseMetadata({
        provider: "inception",
        model: "mercury-2",
      }),
      "mercury-2",
    );
  });

  test("returns undefined for absent or foreign metadata", () => {
    assert.strictEqual(modelNameFromResponseMetadata(undefined), undefined);
    assert.strictEqual(modelNameFromResponseMetadata({}), undefined);
    assert.strictEqual(modelNameFromResponseMetadata({ model: 42 }), undefined);
    assert.strictEqual(modelNameFromResponseMetadata({ model: "" }), undefined);
  });
});
