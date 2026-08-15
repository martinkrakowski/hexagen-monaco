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
        (v) => v.id === "orders-self-dependency",
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
        (v) => v.id === "billing-missing-adapters",
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
        result.violations.some((v) => v.id === "orders-self-dependency"),
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
        result.violations.some((v) => v.id === "orders-self-dependency"),
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
        !result.violations.some((v) => v.id === "-self-dependency"),
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
