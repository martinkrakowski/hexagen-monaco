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

  const base = {
    id: "x",
    name: "X",
    description: "X",
    version: "1",
    questions: [
      { id: "orm", type: "boolean", prompt: "ORM?" },
      { id: "features", type: "multiselect", prompt: "Features?", options: [] },
    ],
  };

  it("accepts a gated output whose when.answer matches a question", () => {
    const m = validateManifest({
      ...base,
      outputs: [
        "always.ts",
        { path: "drizzle.ts", when: { answer: "orm", equals: true } },
        { path: "rt.ts", when: { answer: "features", includes: "realtime" } },
      ],
    });
    assert.equal(m.outputs.length, 3);
  });

  it("throws when a gated output references an unknown answer", () => {
    assert.throws(
      () =>
        validateManifest({
          ...base,
          outputs: [{ path: "a.ts", when: { answer: "nope", equals: true } }],
        }),
      /unknown answer 'nope'/,
    );
  });

  it("throws when a gated output sets both equals and includes", () => {
    assert.throws(
      () =>
        validateManifest({
          ...base,
          outputs: [
            {
              path: "a.ts",
              when: { answer: "orm", equals: true, includes: "x" },
            },
          ],
        }),
      /at most one of 'equals' or 'includes'/,
    );
  });

  it("throws when equals is not a string or boolean", () => {
    assert.throws(
      () =>
        validateManifest({
          ...base,
          outputs: [{ path: "a.ts", when: { answer: "orm", equals: 5 } }],
        }),
      /'equals' must be a string or boolean/,
    );
  });

  it("throws when includes is not a non-empty string", () => {
    assert.throws(
      () =>
        validateManifest({
          ...base,
          outputs: [
            { path: "a.ts", when: { answer: "features", includes: "" } },
          ],
        }),
      /'includes' must be a non-empty string/,
    );
  });
});
