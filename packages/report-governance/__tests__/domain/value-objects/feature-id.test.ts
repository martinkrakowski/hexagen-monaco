import { describe, it } from "vitest";
import assert from "node:assert";
import {
  createFeatureId,
  featureIdValue,
} from "../../../src/domain/value-objects/feature-id.js";
import { FeatureIdValidationError } from "../../../src/domain/errors.js";

describe("createFeatureId", () => {
  it("creates a FeatureId from a valid string", () => {
    const id = createFeatureId("my-feature");
    assert.strictEqual(featureIdValue(id), "my-feature");
  });

  it("throws FeatureIdValidationError for empty string", () => {
    assert.throws(() => createFeatureId(""), FeatureIdValidationError);
  });

  it("throws FeatureIdValidationError for whitespace-only string", () => {
    assert.throws(() => createFeatureId("   "), FeatureIdValidationError);
  });
});

describe("featureIdValue", () => {
  it("roundtrips the original string value", () => {
    const raw = "feature-abc-123";
    const id = createFeatureId(raw);
    assert.strictEqual(featureIdValue(id), raw);
  });
});
