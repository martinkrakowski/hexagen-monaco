import { describe, it } from "vitest";
import assert from "node:assert";
import {
  IMPORTED_MANIFEST_CORRUPT_MESSAGE,
  isImportedFormState,
  parseImportedManifest,
} from "./imported-manifest";

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
