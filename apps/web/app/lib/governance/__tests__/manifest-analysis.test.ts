import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { analyzeManifest } from "../manifest-analysis";

describe("analyzeManifest — parse failure is never compliant (AUD-005)", () => {
  it("returns ok:false for unparseable YAML", () => {
    const result = analyzeManifest("bounded_contexts: [unclosed");
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /parse/i);
  });

  it("returns ok:false for YAML that parses to a non-object scalar", () => {
    const result = analyzeManifest("42");
    assert.equal(result.ok, false);
  });

  it("treats a valid but empty manifest as compliant (NOT a parse failure)", () => {
    const result = analyzeManifest("bounded_contexts: []");
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
    for (const yaml of [
      "bounded_contexts: {}",
      "bounded_contexts: 42",
      "bounded_contexts: just-a-string",
    ]) {
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
      "bounded_contexts: [alpha, beta, gamma]",
      // Mixed: one real context mapping + one stray scalar is still malformed.
      ["bounded_contexts:", "  - name: orders", "  - just-a-string"].join("\n"),
    ]) {
      const result = analyzeManifest(yaml);
      assert.equal(result.ok, false, `"${yaml}" must be non-compliant`);
      if (!result.ok) assert.match(result.error, /bounded_contexts/);
    }
  });

  it("treats an absent or null bounded_contexts as a compliant empty manifest", () => {
    // Only a PRESENT-but-malformed shape is an error; a missing key or an empty
    // `bounded_contexts:` value is a legitimately empty, compliant manifest.
    for (const yaml of ["other_key: 1", "bounded_contexts:"]) {
      const result = analyzeManifest(yaml);
      assert.equal(result.ok, true, `"${yaml}" is legitimately empty`);
      if (result.ok) assert.equal(result.isCompliant, true);
    }
  });
});

describe("analyzeManifest — shadow rules", () => {
  it("flags a self-dependency as a HIGH error → not compliant", () => {
    const result = analyzeManifest(
      [
        "bounded_contexts:",
        "  - name: orders",
        "    dependencies:",
        "      - name: orders",
      ].join("\n"),
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
      [
        "bounded_contexts:",
        "  - name: billing",
        "    layers:",
        "      application:",
        "        ports:",
        "          in: [ChargeCard]",
        "          out: [SaveInvoice]",
      ].join("\n"),
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
});

describe("analyzeManifest — self-dependency across dependency shapes", () => {
  const selfDep = (deps: string) =>
    analyzeManifest(
      ["bounded_contexts:", "  - name: orders", "    dependencies:", deps].join(
        "\n",
      ),
    );

  it("fires when dependencies is a keyed object (name → config), matching port shape-tolerance", () => {
    const result = selfDep("      orders: {}");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(
        result.violations.some((v) => v.id === "orders-0-self-dependency"),
        "keyed-object self-dependency is detected",
      );
      assert.equal(result.isCompliant, false);
    }
  });

  it("fires when dependencies is an array of bare name strings", () => {
    const result = selfDep("      - orders");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(
        result.violations.some((v) => v.id === "orders-0-self-dependency"),
        "string-array self-dependency is detected",
      );
    }
  });

  it("does NOT fire for two distinct unnamed contexts (empty name is not self-reference)", () => {
    const result = analyzeManifest(
      ["bounded_contexts:", "  - dependencies:", "      - name: ''"].join("\n"),
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
      [
        "bounded_contexts:",
        "  - name: ctx",
        "    layers:",
        "      application:",
        "        ports:",
        "          in: [A, B]",
      ].join("\n"),
    );
    const asObject = analyzeManifest(
      [
        "bounded_contexts:",
        "  - name: ctx",
        "    layers:",
        "      application:",
        "        ports:",
        "          in:",
        "            A: {}",
        "            B: {}",
      ].join("\n"),
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
      [
        "bounded_contexts:",
        "  - name: ctx",
        "    layers:",
        "      application:",
        "        ports:",
        "          in: [A, B]",
        "      domain:",
        "        adapters:",
        "          AdapterA: {}",
      ].join("\n"),
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
    const result = analyzeManifest(
      [
        "bounded_contexts:",
        "  - name: orders",
        "    dependencies: [orders]",
        "  - name: orders",
        "    dependencies: [orders]",
      ].join("\n"),
    );
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
      [
        "bounded_contexts:",
        "  - layers: { application: { ports: { in: [A] } } }",
        "  - layers: { application: { ports: { in: [B] } } }",
      ].join("\n"),
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
      [
        "bounded_contexts:",
        "  - name: orders",
        "    dependencies: [orders, orders]",
      ].join("\n"),
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
