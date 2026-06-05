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

  it("accepts a provides/scope visualizer mapping pair", () => {
    const m = validateManifest({
      id: "x",
      name: "X",
      description: "X",
      version: "1",
      provides: "messaging.out-adapter",
      scope: "context",
    });
    assert.equal(m.provides, "messaging.out-adapter");
    assert.equal(m.scope, "context");
  });

  it("leaves provides/scope undefined when absent", () => {
    const m = validateManifest({
      id: "x",
      name: "X",
      description: "X",
      version: "1",
    });
    assert.equal(m.provides, undefined);
    assert.equal(m.scope, undefined);
  });

  it("throws when provides and scope are not set together", () => {
    const partial = { id: "x", name: "X", description: "X", version: "1" };
    assert.throws(
      () => validateManifest({ ...partial, provides: "messaging.out-adapter" }),
      /set together/,
    );
    assert.throws(
      () => validateManifest({ ...partial, scope: "context" }),
      /set together/,
    );
  });

  it("throws on an invalid scope or empty provides", () => {
    const base2 = { id: "x", name: "X", description: "X", version: "1" };
    assert.throws(
      () => validateManifest({ ...base2, provides: "x", scope: "platform" }),
      /must be one of/,
    );
    assert.throws(
      () => validateManifest({ ...base2, provides: "", scope: "project" }),
      /non-empty string/,
    );
  });

  const base = {
    id: "x",
    name: "X",
    description: "X",
    version: "1",
    questions: [
      { id: "orm", type: "boolean", prompt: "ORM?" },
      { id: "features", type: "multiselect", prompt: "Features?", options: [] },
      { id: "mode", type: "select", prompt: "Mode?", options: ["a", "b"] },
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

  it("accepts a gated output with a non-empty 'in' array on a select answer", () => {
    const m = validateManifest({
      ...base,
      outputs: [{ path: "load.ts", when: { answer: "mode", in: ["a", "b"] } }],
    });
    assert.deepEqual(m.outputs, [
      { path: "load.ts", when: { answer: "mode", in: ["a", "b"] } },
    ]);
  });

  it("throws when 'in' is empty or not an array of non-empty strings", () => {
    for (const bad of [[], ["ok", ""], "x", [1]]) {
      assert.throws(
        () =>
          validateManifest({
            ...base,
            outputs: [{ path: "a.ts", when: { answer: "mode", in: bad } }],
          }),
        /'in' must be a non-empty array of non-empty strings/,
      );
    }
  });

  it("rejects an operator that doesn't fit the question type", () => {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      // `in` / `equals` on a multiselect answer
      [
        { answer: "features", in: ["a"] },
        /multiselect answer supports only 'includes'/,
      ],
      [
        { answer: "features", equals: "a" },
        /multiselect answer supports only 'includes'/,
      ],
      // `includes` / `in` on a boolean answer
      [
        { answer: "orm", includes: "x" },
        /boolean answer supports only 'equals/,
      ],
      [{ answer: "orm", in: ["a"] }, /boolean answer supports only 'equals/],
      // string `equals` on a boolean answer
      [
        { answer: "orm", equals: "true" },
        /'equals' on a boolean answer must be true or false/,
      ],
      // `includes` on a select answer
      [
        { answer: "mode", includes: "a" },
        /'includes' applies only to a multiselect/,
      ],
      // boolean `equals` on a select answer
      [
        { answer: "mode", equals: true },
        /'equals' on a string answer must be a string/,
      ],
    ];
    for (const [when, re] of cases) {
      assert.throws(
        () => validateManifest({ ...base, outputs: [{ path: "a.ts", when }] }),
        re,
      );
    }
  });

  it("accepts operators that fit their question type", () => {
    const m = validateManifest({
      ...base,
      outputs: [
        { path: "1.ts", when: { answer: "orm", equals: true } },
        { path: "2.ts", when: { answer: "features", includes: "realtime" } },
        { path: "3.ts", when: { answer: "mode", equals: "a" } },
        { path: "4.ts", when: { answer: "mode", in: ["a", "b"] } },
        { path: "5.ts", when: { answer: "orm" } }, // bare gate is fine for any type
      ],
    });
    assert.equal(m.outputs.length, 5);
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
