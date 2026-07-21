import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  normalizeLoadedProjects,
  normalizeLayers,
} from "./idb-saved-projects.adapter";

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

  it("defaults layers to [] on both the valid and preserve paths", () => {
    const result = normalizeLoadedProjects([
      { id: "valid", formState: { addOnsAnswers: {} } }, // valid path
      { id: "drift", formState: { boundedContexts: "drift" } }, // preserve path
    ]);
    assert.strictEqual(result.length, 2);
    assert.deepStrictEqual(result[0].layers, []);
    assert.deepStrictEqual(result[1].layers, []);
  });

  it("round-trips a well-formed brainstorm layer through the load path", () => {
    const result = normalizeLoadedProjects([
      {
        id: "p1",
        formState: {},
        layers: [
          {
            id: "L1",
            kind: "brainstorm",
            title: "Initial brainstorm",
            createdAt: 10,
            updatedAt: 20,
            turns: [
              { id: "t1", author: "Grok", content: "propose", at: 11 },
              { id: "t2", author: "Claude", content: "critique" },
            ],
          },
        ],
      },
    ]);
    assert.strictEqual(result.length, 1);
    assert.deepStrictEqual(result[0].layers, [
      {
        id: "L1",
        kind: "brainstorm",
        title: "Initial brainstorm",
        createdAt: 10,
        updatedAt: 20,
        turns: [
          { id: "t1", author: "Grok", content: "propose", at: 11 },
          { id: "t2", author: "Claude", content: "critique" },
        ],
      },
    ]);
  });
});

describe("normalizeLayers (salvage policy)", () => {
  it("returns [] for absent or non-array layers", () => {
    assert.deepStrictEqual(normalizeLayers(undefined, "p"), []);
    assert.deepStrictEqual(normalizeLayers("nope", "p"), []);
    assert.deepStrictEqual(normalizeLayers({ not: "array" }, "p"), []);
  });

  it("drops a turn ONLY when content is not a usable string (payload is sacred)", () => {
    const [layer] = normalizeLayers(
      [
        {
          id: "L",
          title: "t",
          turns: [
            { id: "a", author: "X", content: "keep me" },
            { id: "b", author: "X" }, // no content → dropped
            { id: "c", author: "X", content: 42 }, // non-string content → dropped
            "not-an-object", // → dropped
          ],
        },
      ],
      "p",
    );
    assert.strictEqual(layer.turns.length, 1);
    assert.strictEqual(layer.turns[0].content, "keep me");
  });

  it("defaults bad metadata rather than dropping the turn (author, at)", () => {
    const [layer] = normalizeLayers(
      [
        {
          id: "L",
          title: "t",
          turns: [
            { content: "no author" }, // author defaulted
            { author: 5, content: "bad author type", at: "soon" }, // author defaulted, bad at removed
          ],
        },
      ],
      "p",
    );
    assert.strictEqual(layer.turns[0].author, "Unknown");
    assert.strictEqual(layer.turns[1].author, "Unknown");
    assert.ok(
      !("at" in layer.turns[1]),
      "non-finite at is removed, not stored",
    );
  });

  it("synthesizes stable ids for missing layer/turn ids (deterministic across reloads)", () => {
    const input = [{ title: "t", turns: [{ content: "hi" }] }];
    const a = normalizeLayers(input, "proj");
    const b = normalizeLayers(input, "proj");
    assert.strictEqual(a[0].id, "proj-layer-0");
    assert.strictEqual(a[0].turns[0].id, "proj-layer-0-turn-0");
    // Same input + same projectId → same synthesized ids (no React-key churn).
    assert.deepStrictEqual(a, b);
  });

  it("defaults a missing OR blank title and preserves an unknown future kind", () => {
    const [missing, blank, future] = normalizeLayers(
      [
        { id: "L1", turns: [] },
        { id: "L2", title: "", turns: [] },
        { id: "L3", kind: "decisions", title: "Future", turns: [] },
      ],
      "p",
    );
    assert.strictEqual(missing.title, "Untitled session");
    assert.strictEqual(blank.title, "Untitled session");
    assert.strictEqual(missing.kind, "brainstorm");
    // A newer client's layer kind is preserved, not mislabeled.
    assert.strictEqual(future.kind, "decisions");
  });

  it("drops a non-object layer but keeps its salvageable siblings", () => {
    const layers = normalizeLayers(
      [null, { id: "ok", title: "keep", turns: [] }, 7],
      "p",
    );
    assert.strictEqual(layers.length, 1);
    assert.strictEqual(layers[0].id, "ok");
  });

  it("defaults missing timestamps (updatedAt falls back to createdAt)", () => {
    const [layer] = normalizeLayers(
      [{ id: "L", title: "t", createdAt: 99, turns: [] }],
      "p",
    );
    assert.strictEqual(layer.createdAt, 99);
    assert.strictEqual(layer.updatedAt, 99);
  });
});

/** Minimal LoggerPort capturing warn messages for salvage-logging assertions. */
function warnCollector() {
  const warns: string[] = [];
  const logger = {
    info: () => {},
    warn: (msg: string) => warns.push(msg),
    error: () => {},
    debug: () => {},
    errorWithException: () => {},
  };
  return { warns, logger };
}

describe("normalizeLayers (Phase-2 provenance salvage)", () => {
  it("defaults an unknown kind to brainstorm — logged, layer preserved", () => {
    const { warns, logger } = warnCollector();
    const [layer] = normalizeLayers(
      [{ id: "L", kind: "telepathy", title: "t", turns: [] }],
      "p",
      logger,
    );
    assert.strictEqual(layer.kind, "brainstorm");
    assert.ok(warns.some((w) => /unknown\/missing layer kind/.test(w)));
  });

  it("defaults a missing kind to brainstorm — logged, layer preserved", () => {
    const { warns, logger } = warnCollector();
    const [layer] = normalizeLayers(
      [{ id: "L", title: "t", turns: [] }],
      "p",
      logger,
    );
    assert.strictEqual(layer.kind, "brainstorm");
    assert.ok(warns.some((w) => /unknown\/missing layer kind/.test(w)));
  });

  it("keeps the decisions kind (now a known kind)", () => {
    const { warns, logger } = warnCollector();
    const [layer] = normalizeLayers(
      [{ id: "L", kind: "decisions", title: "t", turns: [] }],
      "p",
      logger,
    );
    assert.strictEqual(layer.kind, "decisions");
    assert.strictEqual(warns.length, 0);
  });

  it("keeps a well-formed produced-manifest link", () => {
    const [layer] = normalizeLayers(
      [
        {
          id: "L",
          kind: "brainstorm",
          title: "t",
          turns: [],
          link: { type: "produced-manifest", at: 1234 },
        },
      ],
      "p",
    );
    assert.deepStrictEqual(layer.link, { type: "produced-manifest", at: 1234 });
  });

  it("drops a malformed link FIELD-level (unknown type / bad at / non-object) — never the layer", () => {
    const { warns, logger } = warnCollector();
    const layers = normalizeLayers(
      [
        {
          id: "L1",
          kind: "brainstorm",
          title: "t",
          turns: [{ id: "a", author: "X", content: "payload survives" }],
          link: { type: "produced-code", at: 1 }, // unknown link type
        },
        {
          id: "L2",
          kind: "brainstorm",
          title: "t",
          turns: [],
          link: { type: "produced-manifest", at: "yesterday" }, // bad at
        },
        {
          id: "L3",
          kind: "brainstorm",
          title: "t",
          turns: [],
          link: "produced-manifest", // not an object
        },
      ],
      "p",
      logger,
    );
    assert.strictEqual(layers.length, 3, "metadata damage never drops a layer");
    for (const layer of layers) {
      assert.ok(!("link" in layer), `link dropped on ${layer.id}`);
    }
    assert.strictEqual(layers[0].turns[0].content, "payload survives");
    assert.strictEqual(
      warns.filter((w) => /dropping malformed link/.test(w)).length,
      3,
    );
  });

  it("keeps a string sourceLayerId and drops a non-string one — layer preserved", () => {
    const { warns, logger } = warnCollector();
    const [good, bad] = normalizeLayers(
      [
        {
          id: "D1",
          kind: "decisions",
          title: "t",
          turns: [],
          sourceLayerId: "L1",
        },
        {
          id: "D2",
          kind: "decisions",
          title: "t",
          turns: [],
          sourceLayerId: 42,
        },
      ],
      "p",
      logger,
    );
    assert.strictEqual(good.sourceLayerId, "L1");
    assert.ok(!("sourceLayerId" in bad));
    assert.ok(warns.some((w) => /non-string sourceLayerId/.test(w)));
  });

  it("round-trips link + sourceLayerId through normalizeLoadedProjects", () => {
    const [project] = normalizeLoadedProjects([
      {
        id: "p1",
        name: "P1",
        formState: {},
        layers: [
          {
            id: "L1",
            kind: "brainstorm",
            title: "Imported project spec",
            turns: [{ id: "t1", author: "Imported", content: "spec" }],
            createdAt: 1,
            updatedAt: 1,
            link: { type: "produced-manifest", at: 2 },
          },
          {
            id: "D1",
            kind: "decisions",
            title: "Decisions — Imported project spec",
            turns: [{ id: "t2", author: "AI", content: "## Decisions" }],
            createdAt: 3,
            updatedAt: 3,
            sourceLayerId: "L1",
          },
        ],
      },
    ]);
    assert.deepStrictEqual(project.layers[0].link, {
      type: "produced-manifest",
      at: 2,
    });
    assert.strictEqual(project.layers[1].sourceLayerId, "L1");
    assert.strictEqual(project.layers[1].kind, "decisions");
  });
});
