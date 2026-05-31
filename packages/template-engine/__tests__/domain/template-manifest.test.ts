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

  it("throws when a gated output sets more than one of equals/includes/in", () => {
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
      /at most one of 'equals', 'includes', or 'in'/,
    );
  });

  it("accepts a gated output with a non-empty 'in' array", () => {
    const m = validateManifest({
      ...base,
      outputs: [
        { path: "load.ts", when: { answer: "features", in: ["a", "b"] } },
      ],
    });
    assert.deepEqual(m.outputs, [
      { path: "load.ts", when: { answer: "features", in: ["a", "b"] } },
    ]);
  });

  it("throws when 'in' is empty or not an array of non-empty strings", () => {
    for (const bad of [[], ["ok", ""], "x", [1]]) {
      assert.throws(
        () =>
          validateManifest({
            ...base,
            outputs: [{ path: "a.ts", when: { answer: "features", in: bad } }],
          }),
        /'in' must be a non-empty array of non-empty strings/,
      );
    }
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

  it("rejects non-string entries in conflicts (gated conflicts no longer supported)", () => {
    assert.throws(
      () =>
        validateManifest({
          ...base,
          conflicts: [{ id: "x", when: { answer: "orm", equals: true } }],
        }),
      /must be an array of strings/,
    );
  });

  it("rejects a conflicts field that is a string (no silent coercion to [])", () => {
    assert.throws(
      () =>
        validateManifest({
          ...base,
          conflicts: "rate-limiting",
        }),
      /Template manifest field 'conflicts' must be an array of strings/,
    );
  });

  it("rejects a conflicts field that is an object (no silent coercion to [])", () => {
    // The dormant gated-conflict shape was a `{ id, when }` object; verify
    // a literal object-shaped conflicts field can't slip through validation
    // as "no conflicts".
    assert.throws(
      () =>
        validateManifest({
          ...base,
          conflicts: {
            id: "rate-limiting",
            when: { answer: "x", equals: true },
          },
        }),
      /Template manifest field 'conflicts' must be an array of strings/,
    );
  });

  it("rejects a requires field that is a string (no silent coercion to [])", () => {
    // Same strictness applies to other string-array fields — validate the
    // helper itself, not just the conflicts call site.
    assert.throws(
      () =>
        validateManifest({
          ...base,
          requires: "env-setup",
        }),
      /Template manifest field 'requires' must be an array of strings/,
    );
  });

  it("accepts absent (undefined) array fields as empty (back-compat)", () => {
    // The previous behaviour for the "absent field" case stays — when a
    // manifest simply doesn't declare requires/conflicts/envVars/checklist,
    // the validator treats it as empty rather than throwing.
    const m = validateManifest({
      id: "min",
      name: "Min",
      description: "minimal",
      version: "1.0.0",
    });
    assert.deepEqual(m.requires, []);
    assert.deepEqual(m.conflicts, []);
    assert.deepEqual(m.envVars, []);
    assert.deepEqual(m.checklist, []);
  });
});
