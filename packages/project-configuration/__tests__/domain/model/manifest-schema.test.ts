import assert from "node:assert";
import { ManifestSchema } from "../../src/domain/model/manifest-schema/manifest-schema";

(() => {
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
  assert.strictEqual(
    manifestResult.success,
    true,
    "ManifestSchema should validate a manifest document",
  );

  console.log("✅ manifest-schema tests passed");
})();
