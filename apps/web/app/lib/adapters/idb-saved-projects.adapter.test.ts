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
});
