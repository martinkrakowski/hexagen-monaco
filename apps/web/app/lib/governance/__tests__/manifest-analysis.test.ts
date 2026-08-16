import { describe, it, beforeAll } from "vitest";
import assert from "node:assert/strict";
import {
  analyzeManifest,
  MANIFEST_KEY_PATHS,
  CONTEXT_KEY_PATHS,
  BOUNDED_CONTEXTS_KEY,
} from "../manifest-analysis";
import {
  loadRealMergedManifest,
  collectKeyPaths,
  type RealManifest,
} from "./real-manifest";

/**
 * Fixture policy for this suite.
 *
 * The defect this file now guards against (dossier §2.2) survived review
 * because the old suite hand-wrote `layers.domain.adapters` — a shape no
 * `context.yaml` in this repo has ever had — so the analyzer's dead read and
 * its fixture agreed with each other and disagreed with reality. The suite was
 * green while `adapterCount` was pinned at 0 for every manifest in existence.
 *
 * So: anything that asserts a manifest KEY is driven from `.architecture/`
 * (`loadRealMergedManifest`). Hand-written YAML is kept only for inputs that
 * cannot exist as a real manifest file — unparseable text, a `bounded_contexts`
 * that is a scalar, a context that depends on itself — and even those spell
 * their keys through `CONTEXT_KEY_PATHS`/`BOUNDED_CONTEXTS_KEY` rather than as
 * loose string literals, so a key rename cannot leave a stale fixture behind.
 */

/** Build a synthetic manifest whose KEY NAMES come from the declared set, so a
 * fixture can never encode a key the analyzer does not read (or vice versa).
 * Only the VALUES are hand-written. JSON is valid YAML, so this is a legitimate
 * `analyzeManifest` input. */
function syntheticManifest(
  contexts: ReadonlyArray<Record<string, unknown>>,
): string {
  return JSON.stringify({ [BOUNDED_CONTEXTS_KEY]: contexts });
}

/** Nest a value at a declared context key path, e.g.
 * `atPath(CONTEXT_KEY_PATHS.adapters, ["A"])`
 * → `{ layers: { infrastructure: { adapters: ["A"] } } }`. */
function atPath(
  path: readonly string[],
  value: unknown,
): Record<string, unknown> {
  return path.reduceRight<unknown>(
    (acc, segment) => ({ [segment]: acc }),
    value,
  ) as Record<string, unknown>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep-merge the plain objects produced by `atPath`. */
function mergeShapes(
  ...shapes: ReadonlyArray<Record<string, unknown>>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const shape of shapes) {
    for (const [key, value] of Object.entries(shape)) {
      const existing = out[key];
      out[key] =
        isPlainObject(existing) && isPlainObject(value)
          ? mergeShapes(existing, value)
          : value;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The real manifest — the fixture that cannot drift from production
// ---------------------------------------------------------------------------

describe("analyzeManifest — against the repo's own .architecture manifest", () => {
  let real: RealManifest;
  let analysis: ReturnType<typeof analyzeManifest>;

  beforeAll(async () => {
    real = await loadRealMergedManifest();
    analysis = analyzeManifest(real.yamlText);
  });

  it("parses the real merged manifest", () => {
    assert.equal(
      analysis.ok,
      true,
      analysis.ok ? "" : `real manifest failed to analyze: ${analysis.error}`,
    );
    if (analysis.ok) {
      assert.ok(
        analysis.status.length > 0,
        "the real manifest declares bounded contexts",
      );
    }
  });

  it("counts a non-zero number of adapters (was pinned at 0 by a phantom key)", () => {
    // RED before the fix: `layers.domain.adapters` exists in ZERO context files,
    // so every entry reported `adapters: 0` no matter how many adapters the
    // context actually declares under `layers.infrastructure`.
    assert.equal(analysis.ok, true);
    if (!analysis.ok) return;
    const withAdapters = analysis.status.filter((s) => s.adapters > 0);
    assert.ok(
      withAdapters.length > 0,
      `no context reported any adapter; the analyzer is reading a key the manifest does not use. Statuses: ${JSON.stringify(
        analysis.status.slice(0, 5),
      )}`,
    );
  });

  it("marks at least one real context complete (was pinned at false)", () => {
    // `complete` is `ports > 0 && adapters >= ceil(ports/2)`. With `adapters`
    // stuck at 0 it could never be true for any manifest ever written.
    assert.equal(analysis.ok, true);
    if (!analysis.ok) return;
    assert.ok(
      analysis.status.some((s) => s.complete),
      "no context is complete; `complete` is unreachable, not merely unmet",
    );
  });

  it("does not fire the missing-adapters warning on EVERY context with ports", () => {
    // The shadow rule was unsilenceable: implementing adapters could not clear
    // it, because the count it consulted was always 0.
    assert.equal(analysis.ok, true);
    if (!analysis.ok) return;
    const withPorts = analysis.status.filter((s) => s.ports > 0);
    const warned = analysis.violations.filter((v) =>
      v.id.endsWith("-missing-adapters"),
    );
    assert.ok(withPorts.length > 0, "the real manifest declares ports");
    assert.ok(
      warned.length < withPorts.length,
      `missing-adapters fired on ${warned.length} of ${withPorts.length} port-bearing contexts — an unsilenceable rule`,
    );
  });

  it("reports the real manifest as compliant (no self-dependency errors)", () => {
    assert.equal(analysis.ok, true);
    if (!analysis.ok) return;
    const errors = analysis.violations.filter((v) => v.type === "error");
    assert.deepEqual(
      errors.map((v) => v.message),
      [],
      "the repo's own manifest must not produce HIGH governance errors",
    );
    assert.equal(analysis.isCompliant, true);
  });
});

// ---------------------------------------------------------------------------
// The guard: no read may address a key the real manifest does not provide
// ---------------------------------------------------------------------------

describe("analyzeManifest — every key it reads is a key the manifest provides", () => {
  it("resolves every declared key path against the real merged manifest", async () => {
    // This is the class-level guard. `manifest-analysis.ts` reads NOTHING by
    // hand: every access goes through `readPath(raw, CONTEXT_KEY_PATHS.*)`, so
    // `MANIFEST_KEY_PATHS` is the complete read set. Asserting that set against
    // the repo's own manifest turns "the analyzer reads a phantom key" from a
    // silently-green condition into a failing test.
    //
    // Mutation check: re-point `CONTEXT_KEY_PATHS.adapters` at
    // `["layers", "domain", "adapters"]` (the shipped defect) and this fails —
    // no real context provides `bounded_contexts.layers.domain.adapters`.
    const { parsed } = await loadRealMergedManifest();
    const present = collectKeyPaths(parsed);

    const phantom = MANIFEST_KEY_PATHS.filter((path) => !present.has(path));
    assert.deepEqual(
      phantom,
      [],
      `the analyzer reads key path(s) that appear in NO real .architecture manifest file: ${phantom.join(
        ", ",
      )}. Either the manifest schema changed, or this is a dead read that will report zeros forever.`,
    );
  });

  it("keeps the declared set honest: every read goes through readPath", async () => {
    // The guard above is only as good as the claim that `MANIFEST_KEY_PATHS` is
    // exhaustive. A hand-rolled `raw.layers?.domain?.adapters` would bypass it
    // and reintroduce the defect under a green guard, so assert the source has
    // no direct manifest-key property access left in it.
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const source = await readFile(
      join(__dirname, "..", "manifest-analysis.ts"),
      "utf-8",
    );
    const code = source
      // Strip comments — the module documents the old, wrong keys in prose.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
      // Strip lookups INTO the declared set: `CONTEXT_KEY_PATHS.adapters` is
      // the sanctioned accessor, not a manifest property read.
      .replace(/CONTEXT_KEY_PATHS\.\w+/g, "");
    const manifestKeyAccess =
      /[.?]\s*(layers|adapters|dependencies|depends_on|bounded_contexts|use_cases|entities|value_objects|relationships|wiring)\b/;
    const offending = code
      .split("\n")
      .filter((line) => manifestKeyAccess.test(line));
    assert.deepEqual(
      offending,
      [],
      "manifest keys must be reached via readPath(CONTEXT_KEY_PATHS.*), not direct property access — otherwise MANIFEST_KEY_PATHS stops being the complete read set",
    );
  });
});

// ---------------------------------------------------------------------------
// Inputs that cannot exist as a real manifest file (hand-written by necessity)
// ---------------------------------------------------------------------------

describe("analyzeManifest — parse failure is never compliant (AUD-005)", () => {
  it("returns ok:false for unparseable YAML", () => {
    const result = analyzeManifest(`${BOUNDED_CONTEXTS_KEY}: [unclosed`);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /parse/i);
  });

  it("returns ok:false for YAML that parses to a non-object scalar", () => {
    const result = analyzeManifest("42");
    assert.equal(result.ok, false);
  });

  it("treats a valid but empty manifest as compliant (NOT a parse failure)", () => {
    const result = analyzeManifest(syntheticManifest([]));
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.status, []);
      assert.deepEqual(result.violations, []);
      assert.equal(result.isCompliant, true);
    }
  });

  it("returns ok:false when bounded_contexts is present but not a list", () => {
    // A mapping / scalar / bare-string `bounded_contexts` parses fine but is
    // structurally unusable — it must NOT report compliant-empty (a false green
    // this module exists to kill), the same class as a non-object root.
    for (const value of ["{}", "42", "just-a-string"]) {
      const yaml = `${BOUNDED_CONTEXTS_KEY}: ${value}`;
      const result = analyzeManifest(yaml);
      assert.equal(result.ok, false, `"${yaml}" must be non-compliant`);
      if (!result.ok) assert.match(result.error, /bounded_contexts/);
    }
  });

  it("returns ok:false when bounded_contexts is a list of non-mapping elements", () => {
    // `bounded_contexts: [alpha, beta]` IS an array, so it clears the not-a-list
    // guard, but every element is a bare scalar. The per-context loop skips
    // non-record elements, so without an explicit shape check the whole list is
    // silently dropped and the manifest reads compliant-empty — a false green.
    for (const yaml of [
      `${BOUNDED_CONTEXTS_KEY}: [alpha, beta, gamma]`,
      // Mixed: one real context mapping + one stray scalar is still malformed.
      [
        `${BOUNDED_CONTEXTS_KEY}:`,
        "  - name: orders",
        "  - just-a-string",
      ].join("\n"),
    ]) {
      const result = analyzeManifest(yaml);
      assert.equal(result.ok, false, `"${yaml}" must be non-compliant`);
      if (!result.ok) assert.match(result.error, /bounded_contexts/);
    }
  });

  it("treats an absent or null bounded_contexts as a compliant empty manifest", () => {
    // Only a PRESENT-but-malformed shape is an error; a missing key or an empty
    // `bounded_contexts:` value is a legitimately empty, compliant manifest.
    for (const yaml of ["other_key: 1", `${BOUNDED_CONTEXTS_KEY}:`]) {
      const result = analyzeManifest(yaml);
      assert.equal(result.ok, true, `"${yaml}" is legitimately empty`);
      if (result.ok) assert.equal(result.isCompliant, true);
    }
  });
});

// ---------------------------------------------------------------------------
// Shadow rules — keys come from the declared set, values are hand-written
// ---------------------------------------------------------------------------

describe("analyzeManifest — shadow rules", () => {
  it("flags a self-dependency as a HIGH error → not compliant", () => {
    const result = analyzeManifest(
      syntheticManifest([
        mergeShapes(atPath(CONTEXT_KEY_PATHS.name, "orders"), {
          ...atPath(CONTEXT_KEY_PATHS.dependsOn, [{ name: "orders" }]),
        }),
      ]),
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      const selfDep = result.violations.find(
        (v) => v.id === "orders-0-self-dependency",
      );
      assert.ok(selfDep, "self-dependency violation present");
      assert.equal(selfDep?.type, "error");
      assert.equal(result.isCompliant, false);
    }
  });

  it("flags ports-without-adapters as a MEDIUM warning → still compliant", () => {
    const result = analyzeManifest(
      syntheticManifest([
        mergeShapes(
          atPath(CONTEXT_KEY_PATHS.name, "billing"),
          atPath(CONTEXT_KEY_PATHS.portsIn, ["ChargeCard"]),
          atPath(CONTEXT_KEY_PATHS.portsOut, ["SaveInvoice"]),
        ),
      ]),
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.status[0].ports, 2);
      assert.equal(result.status[0].adapters, 0);
      assert.equal(result.status[0].complete, false);
      const warn = result.violations.find(
        (v) => v.id === "billing-0-missing-adapters",
      );
      assert.equal(warn?.type, "warning");
      // A warning alone is not an error → the manifest stays compliant.
      assert.equal(result.isCompliant, true);
    }
  });

  it("clears the missing-adapters warning once adapters are declared", () => {
    const result = analyzeManifest(
      syntheticManifest([
        mergeShapes(
          atPath(CONTEXT_KEY_PATHS.name, "billing"),
          atPath(CONTEXT_KEY_PATHS.portsIn, ["ChargeCard"]),
          atPath(CONTEXT_KEY_PATHS.adapters, ["StripeChargeAdapter"]),
        ),
      ]),
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.status[0].adapters, 1);
      assert.equal(
        result.violations.filter((v) => v.id.endsWith("-missing-adapters"))
          .length,
        0,
        "declaring an adapter must be able to silence the rule",
      );
    }
  });
});

describe("analyzeManifest — self-dependency across dependency shapes", () => {
  const selfDep = (deps: unknown) =>
    analyzeManifest(
      syntheticManifest([
        mergeShapes(
          atPath(CONTEXT_KEY_PATHS.name, "orders"),
          atPath(CONTEXT_KEY_PATHS.dependsOn, deps),
        ),
      ]),
    );

  it("fires when depends_on is an array of bare name strings (the real shape)", () => {
    const result = selfDep(["orders"]);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(
        result.violations.some((v) => v.id === "orders-0-self-dependency"),
        "string-array self-dependency is detected",
      );
    }
  });

  it("fires when depends_on is a keyed object (name → config), matching port shape-tolerance", () => {
    const result = selfDep({ orders: {} });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(
        result.violations.some((v) => v.id === "orders-0-self-dependency"),
        "keyed-object self-dependency is detected",
      );
      assert.equal(result.isCompliant, false);
    }
  });

  it("does NOT fire for two distinct unnamed contexts (empty name is not self-reference)", () => {
    const result = analyzeManifest(
      syntheticManifest([atPath(CONTEXT_KEY_PATHS.dependsOn, [{ name: "" }])]),
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(
        !result.violations.some((v) => v.id.endsWith("-self-dependency")),
        "an empty name must not be treated as a self-dependency",
      );
    }
  });
});

describe("analyzeManifest — unified port counting", () => {
  it("counts a port list identically whether it is an array or a keyed object", () => {
    const asArray = analyzeManifest(
      syntheticManifest([
        mergeShapes(
          atPath(CONTEXT_KEY_PATHS.name, "ctx"),
          atPath(CONTEXT_KEY_PATHS.portsIn, ["A", "B"]),
        ),
      ]),
    );
    const asObject = analyzeManifest(
      syntheticManifest([
        mergeShapes(
          atPath(CONTEXT_KEY_PATHS.name, "ctx"),
          atPath(CONTEXT_KEY_PATHS.portsIn, { A: {}, B: {} }),
        ),
      ]),
    );
    assert.equal(asArray.ok, true);
    assert.equal(asObject.ok, true);
    if (asArray.ok && asObject.ok) {
      // Historically `status` (array `.length`) and `violations`
      // (`Object.keys`) disagreed on the object shape; now they agree.
      assert.equal(asArray.status[0].ports, 2);
      assert.equal(asObject.status[0].ports, 2);
    }
  });

  it("marks a context complete once adapters reach ceil(ports/2)", () => {
    const result = analyzeManifest(
      syntheticManifest([
        mergeShapes(
          atPath(CONTEXT_KEY_PATHS.name, "ctx"),
          atPath(CONTEXT_KEY_PATHS.portsIn, ["A", "B"]),
          atPath(CONTEXT_KEY_PATHS.adapters, ["AdapterA"]),
        ),
      ]),
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.status[0].ports, 2);
      assert.equal(result.status[0].adapters, 1);
      assert.equal(result.status[0].complete, true); // 1 >= ceil(2/2)
    }
  });
});

describe("analyzeManifest — violation ids are unique (React-key safe)", () => {
  it("gives two identically-named self-dependent contexts distinct ids", () => {
    // The governance UI keys its violation list on `violation.id`; two contexts
    // that share a name must not collide on `<name>-self-dependency`.
    const context = mergeShapes(
      atPath(CONTEXT_KEY_PATHS.name, "orders"),
      atPath(CONTEXT_KEY_PATHS.dependsOn, ["orders"]),
    );
    const result = analyzeManifest(syntheticManifest([context, context]));
    assert.equal(result.ok, true);
    if (result.ok) {
      const selfDeps = result.violations.filter((v) =>
        v.id.endsWith("-self-dependency"),
      );
      assert.equal(selfDeps.length, 2, "one self-dependency per context");
      assert.equal(
        new Set(selfDeps.map((v) => v.id)).size,
        2,
        "ids are unique even when the contexts share a name",
      );
    }
  });

  it("gives two unnamed ports-without-adapters contexts distinct ids", () => {
    const result = analyzeManifest(
      syntheticManifest([
        atPath(CONTEXT_KEY_PATHS.portsIn, ["A"]),
        atPath(CONTEXT_KEY_PATHS.portsIn, ["B"]),
      ]),
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      const warns = result.violations.filter((v) =>
        v.id.endsWith("-missing-adapters"),
      );
      assert.equal(warns.length, 2);
      assert.equal(
        new Set(warns.map((v) => v.id)).size,
        2,
        "unnamed contexts must not collide on `unnamed-missing-adapters`",
      );
    }
  });

  it("emits a single self-dependency violation when a context self-lists twice", () => {
    const result = analyzeManifest(
      syntheticManifest([
        mergeShapes(
          atPath(CONTEXT_KEY_PATHS.name, "orders"),
          atPath(CONTEXT_KEY_PATHS.dependsOn, ["orders", "orders"]),
        ),
      ]),
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      const selfDeps = result.violations.filter((v) =>
        v.id.endsWith("-self-dependency"),
      );
      assert.equal(selfDeps.length, 1, "a repeated self-reference is deduped");
    }
  });
});
