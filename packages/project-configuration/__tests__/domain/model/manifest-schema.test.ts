import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ManifestSchema } from "../../src/domain/model/manifest-schema/manifest-schema";

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
});
