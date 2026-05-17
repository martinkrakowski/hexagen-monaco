import { describe, it } from "node:test";
import assert from "node:assert";
import {
  createCleanConfig,
  createDirtyConfig,
  type SanitizedConfig,
} from "../../../src/domain/value-objects/sanitized-config.js";

describe("SanitizedConfig", () => {
  it("createCleanConfig produces isClean=true", () => {
    const config: SanitizedConfig = createCleanConfig(1000);
    assert.strictEqual(config.isClean, true);
    assert.strictEqual(config.redactedCount, 0);
    assert.strictEqual(config.redactedKeys.length, 0);
    assert.strictEqual(config.originalLength, 1000);
    assert.strictEqual(config._tag, "SanitizedConfig");
  });

  it("createDirtyConfig produces isClean=false", () => {
    const config = createDirtyConfig(2000, ["API_KEY", "SECRET_TOKEN"]);
    assert.strictEqual(config.isClean, false);
    assert.strictEqual(config.redactedCount, 2);
    assert.strictEqual(config.redactedKeys.length, 2);
    assert.strictEqual(config.redactedKeys[0], "API_KEY");
    assert.strictEqual(config.originalLength, 2000);
  });

  it("scanTimestamp is recent", () => {
    const before = new Date();
    const config = createCleanConfig(100);
    const after = new Date();
    assert.ok(config.scanTimestamp >= before);
    assert.ok(config.scanTimestamp <= after);
  });
});
