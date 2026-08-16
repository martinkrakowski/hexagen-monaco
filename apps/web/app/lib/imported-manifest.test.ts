import { describe, it } from "vitest";
import assert from "node:assert";
import {
  IMPORTED_MANIFEST_CORRUPT_MESSAGE,
  isImportedFormState,
  parseImportedManifest,
  resolveImportedManifest,
  resolveImportedManifestPayload,
} from "./imported-manifest";

const VALID_MANIFEST_YAML = [
  "system: shop",
  "bounded_contexts:",
  "  - name: billing",
  "    layers:",
  "      application:",
  "        ports:",
  "          in: [ProcessPaymentPort]",
  "          out: [PaymentGatewayPort]",
].join("\n");

describe("isImportedFormState", () => {
  it("is true only for an explicit manifestSource === 'imported'", () => {
    assert.strictEqual(
      isImportedFormState({ manifestSource: "imported" }),
      true,
    );
    assert.strictEqual(
      isImportedFormState({ manifestSource: "wizard" }),
      false,
    );
    // Absent ≡ "wizard": legacy records and every wizard-authored flow must
    // keep today's projection path.
    assert.strictEqual(isImportedFormState({}), false);
    assert.strictEqual(isImportedFormState(null), false);
    assert.strictEqual(isImportedFormState(undefined), false);
    assert.strictEqual(isImportedFormState("imported"), false);
  });
});

describe("parseImportedManifest", () => {
  it("returns the schema-normalized manifest object for valid YAML", () => {
    const result = parseImportedManifest(
      [
        "system: shop",
        "bounded_contexts:",
        "  - name: billing",
        "    layers:",
        "      application:",
        "        ports:",
        "          in: [ProcessPaymentPort]",
        "          out: [PaymentGatewayPort]",
      ].join("\n"),
    );
    assert.ok(result.ok);
    assert.strictEqual(result.manifest.system, "shop");
    const contexts = result.manifest.bounded_contexts as Array<{
      name: string;
    }>;
    assert.strictEqual(contexts[0]?.name, "billing");
  });

  it("accepts JSON text (pre-fix autosave wrote JSON.stringify output)", () => {
    const result = parseImportedManifest(
      JSON.stringify({ system: "shop", bounded_contexts: [] }),
    );
    assert.ok(result.ok);
    assert.strictEqual(result.manifest.system, "shop");
  });

  it("fails closed with the blocking copy on unparseable YAML", () => {
    const result = parseImportedManifest("system: [unclosed");
    assert.ok(!result.ok);
    assert.strictEqual(result.message, IMPORTED_MANIFEST_CORRUPT_MESSAGE);
  });

  it("fails closed on schema-invalid YAML (missing bounded_contexts)", () => {
    const result = parseImportedManifest("system: shop\n");
    assert.ok(!result.ok);
    assert.strictEqual(result.message, IMPORTED_MANIFEST_CORRUPT_MESSAGE);
  });

  it("fails closed on empty / null / undefined input", () => {
    for (const input of ["", "   ", null, undefined]) {
      const result = parseImportedManifest(input);
      assert.ok(
        !result.ok,
        `expected fail-closed for ${JSON.stringify(input)}`,
      );
      assert.strictEqual(result.message, IMPORTED_MANIFEST_CORRUPT_MESSAGE);
    }
  });
});

// REA-005: this decision used to be copied into the export provider, the
// code-view generation hook and the architecture-ZIP download. All three now
// call these, so the fail-closed invariant has exactly one definition.
describe("resolveImportedManifest", () => {
  it("wizard-authored formState → imported: false, and the saved YAML is never consulted", () => {
    // A corrupt manifest alongside a wizard project must NOT block: the
    // wizard-authored path has never read the saved YAML, and a false positive
    // here would break every unimported project.
    const result = resolveImportedManifest({}, "system: [unclosed");
    assert.ok(result.ok);
    assert.strictEqual(result.imported, false);
  });

  it("imported formState → the parsed manifest AND the verbatim YAML text", () => {
    const result = resolveImportedManifest(
      { manifestSource: "imported" },
      VALID_MANIFEST_YAML,
    );
    assert.ok(result.ok);
    assert.ok(result.imported);
    assert.strictEqual(result.manifest.system, "shop");
    // The architecture ZIP writes the stored text byte-for-byte rather than
    // re-dumping the parsed object (which would churn formatting/comments).
    assert.strictEqual(result.yamlContent, VALID_MANIFEST_YAML);
  });

  it("imported formState + corrupt manifest → fails closed, never a wizard fallback", () => {
    for (const yamlText of ["system: [unclosed", "system: shop\n", "", null]) {
      const result = resolveImportedManifest(
        { manifestSource: "imported" },
        yamlText,
      );
      assert.ok(!result.ok, `expected fail-closed for ${String(yamlText)}`);
      assert.strictEqual(result.message, IMPORTED_MANIFEST_CORRUPT_MESSAGE);
    }
  });
});

describe("resolveImportedManifestPayload", () => {
  it("wizard-authored → an EMPTY extra, keeping the request byte-identical", () => {
    const result = resolveImportedManifestPayload({}, VALID_MANIFEST_YAML);
    assert.ok(result.ok);
    assert.deepStrictEqual(result.extra, {});
  });

  it("imported → a `manifest` field the routes prefer over their degraded projection", () => {
    const result = resolveImportedManifestPayload(
      { manifestSource: "imported" },
      VALID_MANIFEST_YAML,
    );
    assert.ok(result.ok);
    assert.deepStrictEqual(Object.keys(result.extra), ["manifest"]);
    const manifest = result.extra.manifest as { system: string };
    assert.strictEqual(manifest.system, "shop");
  });

  it("imported + corrupt → the blocking message, and no partial payload", () => {
    const result = resolveImportedManifestPayload(
      { manifestSource: "imported" },
      "system: [unclosed",
    );
    assert.ok(!result.ok);
    assert.strictEqual(result.message, IMPORTED_MANIFEST_CORRUPT_MESSAGE);
  });
});
