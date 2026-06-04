import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { normalizeLoadedProjects } from "./idb-saved-projects.adapter";

/** Read a top-level formState field without leaking `any` into the test. */
const fs = (project: { formState: unknown }): Record<string, unknown> =>
  project.formState as Record<string, unknown>;

describe("normalizeLoadedProjects", () => {
  it("fills the addOnsAnswers default for a valid legacy record missing it", () => {
    const result = normalizeLoadedProjects([
      { id: "p1", name: "P1", formState: {} }, // valid (all schema defaults), no addOnsAnswers
    ]);
    assert.strictEqual(result.length, 1);
    assert.deepStrictEqual(fs(result[0]).addOnsAnswers, {});
  });

  it("preserves unknown/future top-level keys on the VALID path (no silent drop)", () => {
    // projectConfigSchema strips unknown keys on parse; without re-layering, a
    // schema-valid record would lose extra keys — asymmetric with the preserve
    // path and a Path 4 violation (never silently drop user data).
    const result = normalizeLoadedProjects([
      {
        id: "fwd",
        name: "Forward-compat",
        formState: { addOnsAnswers: {}, futureField: "keep me" },
      },
    ]);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(fs(result[0]).futureField, "keep me");
    assert.deepStrictEqual(fs(result[0]).addOnsAnswers, {});
  });

  it("preserves a present addOnsAnswers", () => {
    const result = normalizeLoadedProjects([
      {
        id: "p1",
        formState: { addOnsAnswers: { "rate-limiting": { enabled: true } } },
      },
    ]);
    assert.deepStrictEqual(fs(result[0]).addOnsAnswers, {
      "rate-limiting": { enabled: true },
    });
  });

  it("PRESERVES a schema-invalid (drifted) record with defaults filled — never drops it", () => {
    // A present-but-invalid field (what enum drift looks like): the app renders
    // this today, so it must survive the load, just gain the missing default.
    const result = normalizeLoadedProjects([
      { id: "drifted", formState: { boundedContexts: "not-an-array" } },
    ]);
    assert.strictEqual(result.length, 1, "drifted record must be preserved");
    assert.strictEqual(
      fs(result[0]).boundedContexts,
      "not-an-array",
      "present (drifted) data is kept verbatim",
    );
    assert.deepStrictEqual(
      fs(result[0]).addOnsAnswers,
      {},
      "missing top-level default is still filled",
    );
  });

  it("drops a record whose formState is not an object (true garbage)", () => {
    const result = normalizeLoadedProjects([
      { id: "garbage", formState: "corrupt" },
      { id: "ok", formState: { addOnsAnswers: {} } },
    ]);
    assert.deepStrictEqual(
      result.map((p) => p.id),
      ["ok"],
    );
  });

  it("isolates per-record: one bad record doesn't sink the rest", () => {
    const result = normalizeLoadedProjects([
      { id: "good1", formState: {} },
      { id: "garbage", formState: 42 },
      { id: "good2", formState: { addOnsAnswers: {} } },
    ]);
    assert.deepStrictEqual(
      result.map((p) => p.id),
      ["good1", "good2"],
    );
  });

  it("returns [] for a non-array root (corrupt / empty store)", () => {
    assert.deepStrictEqual(normalizeLoadedProjects(null), []);
    assert.deepStrictEqual(normalizeLoadedProjects("nope"), []);
    assert.deepStrictEqual(normalizeLoadedProjects(undefined), []);
  });

  it("drops a record with a missing/non-string id (unusable — can't be keyed)", () => {
    const result = normalizeLoadedProjects([
      { name: "no id", formState: {} },
      { id: 42, name: "numeric id", formState: {} },
      { id: "ok", formState: {} },
    ]);
    assert.deepStrictEqual(
      result.map((p) => p.id),
      ["ok"],
    );
  });

  it("defaults a missing/non-string name to 'Untitled' — preserves the record", () => {
    const result = normalizeLoadedProjects([
      { id: "noname", formState: {} },
      { id: "badname", name: 123, formState: {} },
      { id: "named", name: "Keep me", formState: {} },
    ]);
    assert.deepStrictEqual(
      result.map((p) => p.name),
      ["Untitled", "Untitled", "Keep me"],
    );
  });

  it("sanitizes a malformed addOnsAnswers to {} on the preserve path (would otherwise 400 export)", () => {
    // addOnsAnswers: null fails strict parse → preserve path; null must not
    // survive, since readAddOnAnswers would return null → the route 400s.
    const result = normalizeLoadedProjects([
      { id: "bad-addons", formState: { addOnsAnswers: null } },
    ]);
    assert.strictEqual(result.length, 1, "record is preserved, not dropped");
    assert.deepStrictEqual(fs(result[0]).addOnsAnswers, {});
  });

  it("does not share mutable nested references between preserved records (no aliasing)", () => {
    const result = normalizeLoadedProjects([
      { id: "a", formState: { boundedContexts: "drift-a" } },
      { id: "b", formState: { boundedContexts: "drift-b" } },
    ]);
    assert.strictEqual(result.length, 2);
    // Both fell through the preserve path and got the default addOnsAnswers {}.
    // Mutating one must not affect the other (structuredClone per record).
    (fs(result[0]).addOnsAnswers as Record<string, unknown>)["x"] = 1;
    assert.deepStrictEqual(
      fs(result[1]).addOnsAnswers,
      {},
      "sibling record's default must be untouched",
    );
  });
});
