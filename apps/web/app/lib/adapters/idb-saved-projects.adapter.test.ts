import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";

// In-memory idb-keyval so IDBSavedProjectsAdapter's read-merge-write can be
// exercised without a real IndexedDB. The pure normalize* tests below don't
// touch it.
const idb = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  // Optional read latency, used to prove the in-tab write queue: with a slow
  // `get`, two unserialized read-merge-writes would both read the SAME
  // pre-state and the second write would clobber the first.
  getDelay: null as (() => Promise<void>) | null,
}));
vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: string) => {
    if (idb.getDelay) await idb.getDelay();
    return idb.store.get(key);
  }),
  set: vi.fn(async (key: string, value: unknown) => {
    idb.store.set(key, value);
  }),
}));

import {
  normalizeLoadedProjects,
  normalizeLayers,
  IDBSavedProjectsAdapter,
} from "./idb-saved-projects.adapter";
import type { SavedProject, ProjectLayer } from "@hexagen/shared";

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

describe("normalizeLoadedProjects (legacy manifestSource discriminator)", () => {
  // Manifest with a named port the wizard's catalog can never emit —
  // provably an accepted import / AI manifest, not wizardToManifest output.
  const importedYaml = [
    "system: shop",
    "bounded_contexts:",
    "  - name: billing",
    "    layers:",
    "      application:",
    "        ports:",
    "          in: [ProcessPaymentPort]",
  ].join("\n");

  // Only wizard-emitted names (bare catalog type + emitted file form).
  const wizardYaml = [
    "bounded_contexts:",
    "  - name: core",
    "    layers:",
    "      application:",
    "        ports:",
    "          in: [rest-controller.in-port.ts]",
    "          out: [relational-db]",
  ].join("\n");

  it("REGRESSION: marks a legacy record 'imported' when its manifest carries a non-catalog port (valid path)", () => {
    const result = normalizeLoadedProjects([
      { id: "legacy", formState: {}, manifestYaml: importedYaml },
    ]);
    assert.strictEqual(fs(result[0]).manifestSource, "imported");
  });

  it("marks a drifted legacy record 'imported' too (preserve-with-defaults path)", () => {
    const result = normalizeLoadedProjects([
      {
        id: "drifted-import",
        // schema-invalid → preserve path
        formState: { boundedContexts: "not-an-array" },
        manifestYaml: importedYaml,
      },
    ]);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(fs(result[0]).manifestSource, "imported");
  });

  it("recognizes {name} port objects and JSON-dialect manifests (pre-fix autosave wrote JSON)", () => {
    const jsonYaml = JSON.stringify({
      bounded_contexts: [
        {
          name: "billing",
          layers: {
            application: { ports: { out: [{ name: "PaymentGatewayPort" }] } },
          },
        },
      ],
    });
    const result = normalizeLoadedProjects([
      { id: "json-legacy", formState: {}, manifestYaml: jsonYaml },
    ]);
    assert.strictEqual(fs(result[0]).manifestSource, "imported");
  });

  it("leaves a catalog-only legacy record unmarked (absent ≡ wizard)", () => {
    const result = normalizeLoadedProjects([
      { id: "legacy-wizard", formState: {}, manifestYaml: wizardYaml },
    ]);
    assert.strictEqual(fs(result[0]).manifestSource, undefined);
  });

  it("leaves an unparseable/absent manifest unmarked (false negative allows at most one more clobber — same as today)", () => {
    const result = normalizeLoadedProjects([
      { id: "bad-yaml", formState: {}, manifestYaml: "a: [unclosed" },
      { id: "no-yaml", formState: {} },
      { id: "empty-yaml", formState: {}, manifestYaml: "   " },
    ]);
    for (const project of result) {
      assert.strictEqual(
        fs(project).manifestSource,
        undefined,
        `expected no marker on ${project.id}`,
      );
    }
  });

  it("NEVER overrides an explicit stored manifestSource (either value)", () => {
    const result = normalizeLoadedProjects([
      {
        id: "explicit-wizard",
        formState: { manifestSource: "wizard" },
        manifestYaml: importedYaml, // would otherwise infer "imported"
      },
      {
        id: "explicit-imported",
        formState: { manifestSource: "imported" },
        manifestYaml: wizardYaml, // catalog-only — inference must not run at all
      },
    ]);
    assert.strictEqual(fs(result[0]).manifestSource, "wizard");
    assert.strictEqual(fs(result[1]).manifestSource, "imported");
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

  it("defaults a missing OR blank title; keeps known kinds", () => {
    const [missing, blank, decisions] = normalizeLayers(
      [
        { id: "L1", turns: [] },
        { id: "L2", title: "", turns: [] },
        { id: "L3", kind: "decisions", title: "Extracted", turns: [] },
      ],
      "p",
    );
    assert.strictEqual(missing.title, "Untitled session");
    assert.strictEqual(blank.title, "Untitled session");
    assert.strictEqual(missing.kind, "brainstorm");
    // Phase 2 reversed the Phase-1 "preserve unknown kinds" policy: only the
    // known kinds pass through; anything else is coerced to "brainstorm" (see
    // the Phase-2 provenance-salvage describe below for the coercion pins).
    assert.strictEqual(decisions.kind, "decisions");
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

  it("keeps valid Phase-3 session fields (status/maxRounds/link, role/round)", () => {
    const [layer] = normalizeLayers(
      [
        {
          id: "L",
          title: "t",
          status: "awaiting-human",
          maxRounds: 4,
          link: { type: "produced-manifest", at: 123 },
          turns: [
            { id: "a", author: "AI", content: "c", role: "critic", round: 2 },
          ],
        },
      ],
      "p",
    );
    assert.strictEqual(layer.status, "awaiting-human");
    assert.strictEqual(layer.maxRounds, 4);
    assert.deepStrictEqual(layer.link, { type: "produced-manifest", at: 123 });
    assert.strictEqual(layer.turns[0].role, "critic");
    assert.strictEqual(layer.turns[0].round, 2);
  });

  it("drops invalid Phase-3 session fields FIELD-LEVEL — never the layer or turn", () => {
    const [layer] = normalizeLayers(
      [
        {
          id: "L",
          title: "t",
          status: "meditating", // unknown status → field dropped
          maxRounds: -1, // non-positive → field dropped
          link: { type: "produced-manifest" }, // missing at → field dropped
          turns: [
            {
              id: "a",
              author: "AI",
              content: "keep",
              role: "villain",
              round: "two",
            },
          ],
        },
      ],
      "p",
    );
    assert.ok(!("status" in layer), "invalid status removed");
    assert.ok(!("maxRounds" in layer), "invalid maxRounds removed");
    assert.ok(!("link" in layer), "invalid link removed");
    assert.strictEqual(layer.turns.length, 1, "turn survives");
    assert.strictEqual(layer.turns[0].content, "keep");
    assert.ok(!("role" in layer.turns[0]), "invalid role removed");
    assert.ok(!("round" in layer.turns[0]), "invalid round removed");
  });

  it("absent Phase-3 fields stay absent (no undefined keys injected)", () => {
    const [layer] = normalizeLayers(
      [
        {
          id: "L",
          title: "t",
          turns: [{ id: "a", author: "X", content: "c" }],
        },
      ],
      "p",
    );
    assert.ok(!("status" in layer));
    assert.ok(!("maxRounds" in layer));
    assert.ok(!("link" in layer));
    assert.ok(!("role" in layer.turns[0]));
    assert.ok(!("round" in layer.turns[0]));
  });
});

describe("IDBSavedProjectsAdapter.updateProjectRecord (read-merge-write)", () => {
  const KEY = "hexagen:saved-projects";
  const record = (
    id: string,
    layers: unknown[] = [],
  ): Record<string, unknown> => ({
    id,
    name: id,
    schemaVersion: 4,
    createdAt: 0,
    updatedAt: 0,
    formState: {},
    manifestYaml: "",
    layers,
  });

  beforeEach(() => {
    idb.store.clear();
    idb.getDelay = null;
  });

  it("REGRESSION: merges into the freshly-read record — a stale caller snapshot cannot clobber a concurrently-added layer", async () => {
    // The pre-Phase-3 failure mode: writer A holds an in-memory snapshot, writer
    // B adds a layer, then A does a whole-array saveProjects from its snapshot —
    // B's layer vanishes. With updateProjectRecord the adapter re-reads at write
    // time, so A's mutation lands ON TOP of B's layer instead of replacing it.
    const adapter = new IDBSavedProjectsAdapter();
    idb.store.set(KEY, [record("p1", [])]);

    // Writer B commits a layer directly (fresh write).
    await adapter.updateProjectRecord("p1", (p) => ({
      ...p,
      layers: [
        ...(p.layers ?? []),
        {
          id: "from-B",
          kind: "brainstorm",
          title: "B",
          turns: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    }));

    // Writer A still believes layers === [] (its snapshot predates B's write),
    // but appends via read-merge-write — the updater sees B's layer.
    const result = await adapter.updateProjectRecord("p1", (p) => ({
      ...p,
      layers: [
        ...(p.layers ?? []),
        {
          id: "from-A",
          kind: "brainstorm",
          title: "A",
          turns: [],
          createdAt: 2,
          updatedAt: 2,
        },
      ],
    }));

    assert.ok(result.success);
    const stored = idb.store.get(KEY) as Array<{ layers: ProjectLayer[] }>;
    assert.deepStrictEqual(
      stored[0].layers.map((l) => l.id),
      ["from-B", "from-A"],
      "both writers' layers survive",
    );

    // Contrast: the OLD path (whole-array save from A's stale snapshot) loses B.
    await adapter.saveProjects([
      {
        ...record("p1"),
        layers: [
          {
            id: "from-A",
            kind: "brainstorm",
            title: "A",
            turns: [],
            createdAt: 2,
            updatedAt: 2,
          },
        ],
      } as unknown as SavedProject,
    ]);
    const clobbered = idb.store.get(KEY) as Array<{ layers: ProjectLayer[] }>;
    assert.deepStrictEqual(
      clobbered[0].layers.map((l) => l.id),
      ["from-A"],
      "sanity: whole-array save from the stale snapshot is exactly the clobber this port method closes",
    );
  });

  it("touches ONLY the target record — siblings are written back byte-identical", async () => {
    const adapter = new IDBSavedProjectsAdapter();
    const sibling = record("sibling");
    idb.store.set(KEY, [sibling, record("p1")]);

    await adapter.updateProjectRecord("p1", (p) => ({ ...p, name: "renamed" }));

    const stored = idb.store.get(KEY) as unknown[];
    assert.strictEqual(
      stored[0],
      sibling,
      "sibling record is the same reference",
    );
    assert.strictEqual((stored[1] as { name: string }).name, "renamed");
  });

  it("resolves NotFound for an unknown id without writing", async () => {
    const adapter = new IDBSavedProjectsAdapter();
    const before = [record("p1")];
    idb.store.set(KEY, before);

    const result = await adapter.updateProjectRecord("ghost", (p) => ({
      ...p,
      name: "x",
    }));

    assert.strictEqual(result.success, false);
    if (!result.success) assert.strictEqual(result.error.kind, "NotFound");
    assert.strictEqual(idb.store.get(KEY), before, "no write happened");
  });

  it("skips the write when the updater returns its argument unchanged", async () => {
    const adapter = new IDBSavedProjectsAdapter();
    const before = [record("p1")];
    idb.store.set(KEY, before);

    const result = await adapter.updateProjectRecord("p1", (p) => p);

    assert.ok(result.success);
    assert.strictEqual(idb.store.get(KEY), before, "same-reference → no write");
  });

  it("serializes concurrent same-instance writes — overlapping read-merge-writes cannot lose an update", async () => {
    // Two callbacks (e.g. the session loop's turn append and a control
    // action's status write) can start their read-merge-write in the same
    // tick. With slow reads and NO queue, both would read the same pre-state
    // and the later write would silently drop the earlier one. The adapter's
    // in-tab promise queue forces write 2 to read AFTER write 1 committed.
    const adapter = new IDBSavedProjectsAdapter();
    idb.store.set(KEY, [record("p1", [])]);
    idb.getDelay = () => new Promise((resolve) => setTimeout(resolve, 5));

    const layerOf = (id: string) => ({
      id,
      kind: "brainstorm",
      title: id,
      turns: [],
      createdAt: 1,
      updatedAt: 1,
    });
    const [r1, r2] = await Promise.all([
      adapter.updateProjectRecord("p1", (p) => ({
        ...p,
        layers: [...(p.layers ?? []), layerOf("first") as ProjectLayer],
      })),
      adapter.updateProjectRecord("p1", (p) => ({
        ...p,
        layers: [...(p.layers ?? []), layerOf("second") as ProjectLayer],
      })),
    ]);

    assert.ok(r1.success);
    assert.ok(r2.success);
    const stored = idb.store.get(KEY) as Array<{ layers: ProjectLayer[] }>;
    assert.deepStrictEqual(
      stored[0].layers.map((l) => l.id),
      ["first", "second"],
      "both concurrent writes survive, in submission order",
    );
  });

  it("createProjectRecord PREPENDS via a fresh read and leaves siblings byte-identical", async () => {
    const adapter = new IDBSavedProjectsAdapter();
    const sibling = record("existing");
    idb.store.set(KEY, [sibling]);

    const created = record("new") as unknown as SavedProject;
    const result = await adapter.createProjectRecord(created);

    assert.ok(result.success);
    const stored = idb.store.get(KEY) as Array<{ id: string }>;
    assert.deepStrictEqual(
      stored.map((p) => p.id),
      ["new", "existing"],
      "new record is prepended (newest-first)",
    );
    assert.strictEqual(stored[1], sibling, "sibling is the same reference");
  });

  it("createProjectRecord rejects a duplicate id with Conflict — never a silent overwrite", async () => {
    const adapter = new IDBSavedProjectsAdapter();
    const before = [record("p1")];
    idb.store.set(KEY, before);

    const result = await adapter.createProjectRecord(
      record("p1") as unknown as SavedProject,
    );

    assert.strictEqual(result.success, false);
    if (!result.success) assert.strictEqual(result.error.kind, "Conflict");
    assert.strictEqual(idb.store.get(KEY), before, "no write happened");
  });

  it("deleteProjectRecord removes only the target — siblings byte-identical", async () => {
    const adapter = new IDBSavedProjectsAdapter();
    const sibling = record("keep");
    idb.store.set(KEY, [sibling, record("doomed")]);

    const result = await adapter.deleteProjectRecord("doomed");

    assert.ok(result.success);
    const stored = idb.store.get(KEY) as unknown[];
    assert.deepStrictEqual(
      stored.map((p) => (p as { id: string }).id),
      ["keep"],
    );
    assert.strictEqual(stored[0], sibling, "sibling is the same reference");
  });

  it("deleteProjectRecord is IDEMPOTENT — an absent id resolves success without a write", async () => {
    // Deliberate divergence from updateProjectRecord's NotFound (port D6): the
    // hook's delete revert arm would otherwise resurrect a row that another
    // writer had already deleted from storage.
    const adapter = new IDBSavedProjectsAdapter();
    const before = [record("p1")];
    idb.store.set(KEY, before);

    const result = await adapter.deleteProjectRecord("already-gone");

    assert.ok(result.success, "absent id is success, not NotFound");
    assert.strictEqual(idb.store.get(KEY), before, "no write happened");
  });

  it("INTERLEAVE PIN: a queued turn-append is not reverted by a concurrent create/delete/rename", async () => {
    // The §3.3 regression class: with slow reads and NO write queue, the
    // create/delete/rename would read a pre-append snapshot and their write
    // would land without the turn. The queue forces each write to read AFTER
    // the previous one committed, so the appended turn survives all three.
    const adapter = new IDBSavedProjectsAdapter();
    idb.store.set(KEY, [
      record("p1", [
        {
          id: "L1",
          kind: "brainstorm",
          title: "session",
          turns: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
      record("doomed"),
    ]);
    idb.getDelay = () => new Promise((resolve) => setTimeout(resolve, 5));

    const [appended, created, deleted, renamed] = await Promise.all([
      // The live-session turn append…
      adapter.updateProjectRecord("p1", (p) => ({
        ...p,
        layers: (p.layers ?? []).map((l) =>
          l.id === "L1"
            ? {
                ...l,
                turns: [
                  ...l.turns,
                  { id: "t1", author: "Critic", content: "landed" },
                ],
              }
            : l,
        ),
      })),
      // …racing a create, a delete, and a rename submitted in the same tick.
      adapter.createProjectRecord(
        record("brand-new") as unknown as SavedProject,
      ),
      adapter.deleteProjectRecord("doomed"),
      adapter.updateProjectRecord("p1", (p) => ({ ...p, name: "renamed" })),
    ]);

    assert.ok(appended.success);
    assert.ok(created.success);
    assert.ok(deleted.success);
    assert.ok(renamed.success);
    const stored = idb.store.get(KEY) as Array<{
      id: string;
      name: string;
      layers: Array<{ turns: Array<{ id: string }> }>;
    }>;
    assert.deepStrictEqual(
      stored.map((p) => p.id),
      ["brand-new", "p1"],
      "create landed (prepended), delete landed, p1 survives",
    );
    const p1 = stored.find((p) => p.id === "p1");
    assert.ok(p1);
    assert.deepStrictEqual(
      p1.layers[0].turns.map((t) => t.id),
      ["t1"],
      "the queued turn append was NOT reverted by the concurrent writers",
    );
    assert.strictEqual(p1.name, "renamed", "the rename landed too");
  });

  it("hands the updater a record with SALVAGED layers (load-path parity)", async () => {
    const adapter = new IDBSavedProjectsAdapter();
    idb.store.set(KEY, [
      record("p1", [
        {
          id: "L1",
          title: "t",
          status: "meditating", // invalid → dropped field-level before the updater sees it
          turns: [{ id: "a", author: "X", content: "keep" }, { id: "b" }], // contentless turn dropped
        },
      ]),
    ]);

    let seen: ProjectLayer[] = [];
    await adapter.updateProjectRecord("p1", (p) => {
      seen = [...(p.layers ?? [])];
      return { ...p, name: "touched" };
    });

    assert.strictEqual(seen.length, 1);
    assert.ok(!("status" in seen[0]));
    assert.strictEqual(seen[0].turns.length, 1);
  });
});

describe("IDBSavedProjectsAdapter cache owner stamp", () => {
  beforeEach(() => {
    idb.store.clear();
    idb.getDelay = null;
  });

  it("round-trips an authenticated owner id separately from the project list", async () => {
    const adapter = new IDBSavedProjectsAdapter();
    assert.equal(await adapter.getCacheOwner(), null);
    await adapter.setCacheOwner("owner-a");
    assert.equal(await adapter.getCacheOwner(), "owner-a");
    await adapter.setCacheOwner(null);
    assert.equal(await adapter.getCacheOwner(), null);
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
    assert.ok(project.layers, "layers survive normalizeLoadedProjects");
    assert.deepStrictEqual(project.layers[0].link, {
      type: "produced-manifest",
      at: 2,
    });
    assert.strictEqual(project.layers[1].sourceLayerId, "L1");
    assert.strictEqual(project.layers[1].kind, "decisions");
  });
});
