import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateManifest } from "../../src/domain/template-manifest.js";

describe("validateManifest", () => {
  it("accepts a valid minimal manifest", () => {
    const m = validateManifest({
      id: "test",
      name: "Test",
      description: "A test template",
      version: "1.0.0",
    });
    assert.equal(m.id, "test");
    assert.deepEqual(m.requires, []);
    assert.deepEqual(m.outputs, []);
    assert.deepEqual(m.checklist, []);
  });

  it("throws when id is missing", () => {
    assert.throws(() =>
      validateManifest({ name: "Test", description: "x", version: "1" }),
    );
  });

  it("throws when manifest is not an object", () => {
    assert.throws(() => validateManifest("not-an-object"));
    assert.throws(() => validateManifest(null));
    assert.throws(() => validateManifest(42));
  });

  it("defaults array fields to empty arrays", () => {
    const m = validateManifest({
      id: "x",
      name: "X",
      description: "X",
      version: "1",
    });
    assert.deepEqual(m.requires, []);
    assert.deepEqual(m.conflicts, []);
    assert.deepEqual(m.questions, []);
    assert.deepEqual(m.envVars, []);
    assert.deepEqual(m.outputs, []);
    assert.deepEqual(m.checklist, []);
  });
});
