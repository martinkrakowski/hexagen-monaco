import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  getAutoLoadEnabled,
  getHasEnabledLocalModels,
  getHasEnabledLocalModelsFlag,
  removeEnginePreferenceKeys,
  saveEngineInitSuccess,
  backfillHasEnabledForMigration,
  resetLocalAIConfig,
} from "../../src/infrastructure/adapters/model-preference-storage.js";

/**
 * The node environment — no `window`, which is exactly the Next.js server
 * render `apps/web` performs before hydration. `@hexagen/shared` is in the web
 * app's `transpilePackages`, so this module is evaluated during SSR and its
 * browser probe runs at import time; a throw or an `undefined` deref here is a
 * blank page, not a degraded feature.
 *
 * Deliberately in its own file: the probe is a module-scope constant, so the
 * server path cannot be reached from the jsdom suite no matter what that suite
 * deletes from `globalThis` after import.
 */
describe("model preference storage without a browser (SSR)", () => {
  it("reports every preference as off rather than throwing", () => {
    assert.equal(getAutoLoadEnabled(), false);
    assert.equal(getHasEnabledLocalModels(), false);
    assert.equal(getHasEnabledLocalModelsFlag(), false);
  });

  it("makes the writers no-ops instead of dereferencing an absent window", () => {
    assert.doesNotThrow(() => saveEngineInitSuccess("qwen3-4b"));
    assert.doesNotThrow(() => removeEnginePreferenceKeys());
    assert.doesNotThrow(() => backfillHasEnabledForMigration());
  });

  it("reports no cleared keys, so a server-side reset cannot claim it did work", () => {
    assert.deepEqual(resetLocalAIConfig(), []);
  });

  it("has no window to read — the guard is the environment, not a stub", () => {
    assert.equal(typeof globalThis.window, "undefined");
  });
});
