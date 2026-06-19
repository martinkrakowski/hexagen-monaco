import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { buildTemplateBundle } from "../../src/infrastructure/build-template-bundle.js";
import {
  TEMPLATE_MANIFESTS,
  TEMPLATE_FILES,
} from "../../src/infrastructure/generated/template-bundle.generated.js";
// Import through the public subpath entrypoint (not the adapter directly) so the
// test also guards that `@hexagen/template-engine/in-memory` keeps exporting it.
import { createInMemoryMaterializer } from "../../src/in-memory.js";

describe("template bundle parity", () => {
  it("the generated bundle matches a fresh read of templates/", async () => {
    const fresh = await buildTemplateBundle();

    assert.deepStrictEqual(
      TEMPLATE_FILES,
      fresh.files,
      "generated TEMPLATE_FILES is stale — run `yarn workspace @hexagen/template-engine gen:bundle`",
    );
    // Round-trip `fresh` through JSON so an undefined-valued field drops the
    // same way it did when the module was generated.
    assert.deepStrictEqual(
      TEMPLATE_MANIFESTS,
      JSON.parse(JSON.stringify(fresh.manifests)),
      "generated TEMPLATE_MANIFESTS is stale — run `yarn workspace @hexagen/template-engine gen:bundle`",
    );
  });
});

describe("createInMemoryMaterializer", () => {
  it("materializes from the bundle with no filesystem access", async () => {
    const materializer = createInMemoryMaterializer();
    const { files, errors } = await materializer.materialize({
      "rate-limiting": {},
    });

    assert.deepStrictEqual(errors, []);
    assert.ok(files.size > 0, "should emit files from the bundled sources");
  });
});
