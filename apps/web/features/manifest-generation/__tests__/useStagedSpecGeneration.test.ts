import { test, describe } from "node:test";
import assert from "node:assert";
import { resolveExecutionStrategy } from "../useStagedSpecGeneration.ts";

describe("resolveExecutionStrategy", () => {
  test("returns local when strategy is local and hasLocalLLM is true", () => {
    assert.strictEqual(resolveExecutionStrategy("local", true, false), "local");
  });

  test("returns none when strategy is local and hasLocalLLM is false", () => {
    assert.strictEqual(resolveExecutionStrategy("local", false, true), "none");
  });

  test("returns cloud when strategy is cloud and hasCloudKeys is true", () => {
    assert.strictEqual(resolveExecutionStrategy("cloud", false, true), "cloud");
  });

  test("returns none when strategy is cloud and hasCloudKeys is false", () => {
    assert.strictEqual(resolveExecutionStrategy("cloud", true, false), "none");
  });

  test("auto: prioritizes cloud when both capabilities present", () => {
    // Cloud-first: the server pipeline finishes in seconds; a loaded WebLLM
    // model must not silently win and burn minutes before falling back.
    assert.strictEqual(resolveExecutionStrategy("auto", true, true), "cloud");
  });

  test("explicit local strategy still wins over available cloud keys", () => {
    assert.strictEqual(resolveExecutionStrategy("local", true, true), "local");
  });

  test("auto: returns local when only local LLM available", () => {
    assert.strictEqual(resolveExecutionStrategy("auto", true, false), "local");
  });

  test("auto: returns cloud when only cloud keys available", () => {
    assert.strictEqual(resolveExecutionStrategy("auto", false, true), "cloud");
  });

  test("auto: returns none when no capabilities available", () => {
    assert.strictEqual(resolveExecutionStrategy("auto", false, false), "none");
  });
});
