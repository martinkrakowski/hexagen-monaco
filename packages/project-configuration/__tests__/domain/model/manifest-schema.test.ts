import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  ManifestSchema,
  PLANE_NAMES,
  PlaneTypeSchema,
} from "../../../src/domain/model/manifest-schema/manifest-schema";
import { HEXAGEN_GENERATOR_NAME } from "../../../src/domain/model/manifest-schema/generator-identity";

describe("ManifestSchema", () => {
  it("should validate a manifest document", () => {
    const manifestResult = ManifestSchema.safeParse({
      system: "hexagen-monaco",
      bounded_contexts: [
        {
          name: "sync",
          type: "core",
          description: "Sync engine",
          layers: {},
        },
      ],
    });
    assert.strictEqual(manifestResult.success, true);
  });

  it("accepts a structured workspace block (R08 — survives strict parse)", () => {
    const manifestResult = ManifestSchema.safeParse({
      workspace: {
        name: "hexagen-monaco",
        description: "Generated workspace",
      },
      system: "hexagen-monaco",
      scope: "hexagen",
      bounded_contexts: [
        { name: "sync", type: "core", description: "Sync engine", layers: {} },
      ],
    });
    assert.strictEqual(manifestResult.success, true);
  });

  it("still rejects genuinely unknown top-level keys (strict mode intact)", () => {
    const manifestResult = ManifestSchema.safeParse({
      system: "hexagen-monaco",
      bounded_contexts: [
        { name: "sync", type: "core", description: "Sync engine", layers: {} },
      ],
      notARealKey: true,
    });
    assert.strictEqual(manifestResult.success, false);
  });
});

describe("ManifestSchema generator.name", () => {
  const baseManifest = { bounded_contexts: [] };

  it("parses a generator block and keeps version/sync (passthrough)", () => {
    const result = ManifestSchema.safeParse({
      ...baseManifest,
      generator: {
        name: "@hexagen-monaco/sync",
        version: "0.2.0",
        sync: { layers: {} },
      },
    });
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.deepStrictEqual(result.data.generator, {
        name: "@hexagen-monaco/sync",
        version: "0.2.0",
        sync: { layers: {} },
      });
    }
  });

  it("accepts a generator block without a name (legacy)", () => {
    const result = ManifestSchema.safeParse({
      ...baseManifest,
      generator: { version: "0.2.0" },
    });
    assert.strictEqual(result.success, true);
  });

  it("accepts a manifest without a generator block (legacy)", () => {
    const result = ManifestSchema.safeParse(baseManifest);
    assert.strictEqual(result.success, true);
  });

  it("rejects an empty or non-string generator.name", () => {
    const emptyName = ManifestSchema.safeParse({
      ...baseManifest,
      generator: { name: "" },
    });
    const numericName = ManifestSchema.safeParse({
      ...baseManifest,
      generator: { name: 42 },
    });
    assert.strictEqual(emptyName.success, false);
    assert.strictEqual(numericName.success, false);
  });

  it("HEXAGEN_GENERATOR_NAME is the published package name", () => {
    assert.strictEqual(HEXAGEN_GENERATOR_NAME, "@hexagen-monaco/sync");
  });
});

describe("PLANE_NAMES / PlaneType (PLANE_NAMES export — structural guard)", () => {
  it("PLANE_NAMES matches the canonical vocabulary (exact members + order)", () => {
    assert.deepStrictEqual(
      [...PLANE_NAMES],
      [
        "projection",
        "probabilistic",
        "infrastructure",
        "shared-kernel",
        "core",
        "supporting",
      ],
    );
  });

  it("PlaneTypeSchema accepts every PLANE_NAMES value", () => {
    for (const name of PLANE_NAMES) {
      assert.strictEqual(PlaneTypeSchema.safeParse(name).success, true);
    }
  });
});
