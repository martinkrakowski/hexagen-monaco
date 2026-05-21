import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolveExecutionStrategy } from "../useStagedSpecGeneration.ts";

describe("resolveExecutionStrategy", () => {
  test("returns local when strategy is local and hasLocalLLM is true", () => {
    assert.equal(resolveExecutionStrategy("local", true, false), "local");
  });

  test("returns none when strategy is local and hasLocalLLM is false", () => {
    assert.equal(resolveExecutionStrategy("local", false, true), "none");
  });

  test("returns cloud when strategy is cloud and hasCloudKeys is true", () => {
    assert.equal(resolveExecutionStrategy("cloud", false, true), "cloud");
  });

  test("returns none when strategy is cloud and hasCloudKeys is false", () => {
    assert.equal(resolveExecutionStrategy("cloud", true, false), "none");
  });

  test("auto: prioritizes local when both capabilities present", () => {
    assert.equal(resolveExecutionStrategy("auto", true, true), "local");
  });

  test("auto: returns local when only local LLM available", () => {
    assert.equal(resolveExecutionStrategy("auto", true, false), "local");
  });

  test("auto: returns cloud when only cloud keys available", () => {
    assert.equal(resolveExecutionStrategy("auto", false, true), "cloud");
  });

  test("auto: returns none when no capabilities available", () => {
    assert.equal(resolveExecutionStrategy("auto", false, false), "none");
  });
});
