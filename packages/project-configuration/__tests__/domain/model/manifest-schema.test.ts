import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  ManifestSchema,
  PLANE_NAMES,
  PlaneTypeSchema,
} from "../../../src/domain/model/manifest-schema/manifest-schema";

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
