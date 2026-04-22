// hexagen-monaco/packages/deployment/__tests__/infrastructure/adapters/render-manifest.test.ts

import assert from "node:assert";
import { FakeRenderManifestPort } from "../../doubles/ports/render-manifest.fake";

/**
 * Minimal test suite for `FakeRenderManifestPort` in the `deployment` package.
 * Uses Node's built‑in `assert` – no external test runner required.
 */
(async () => {
  // 1️⃣ Default behavior – echo the input unchanged
  const defaultFake = new FakeRenderManifestPort();
  const defaultInput = { foo: "bar" };
  const defaultResult = await defaultFake.execute(defaultInput);
  assert.deepStrictEqual(
    defaultResult,
    defaultInput,
    "Default fake should return the input unchanged",
  );

  // 2️⃣ Custom behavior – transform the input
  const customFake = new FakeRenderManifestPort();
  customFake.setBehavior(async (data) => ({
    transformed: true,
    original: data,
  }));
  const customInput = { baz: 42 };
  const customResult = await customFake.execute(customInput);
  assert.deepStrictEqual(
    customResult,
    { transformed: true, original: customInput },
    "Custom fake should apply transformation",
  );

  console.log("✅ All FakeRenderManifestPort tests passed.");
})();
