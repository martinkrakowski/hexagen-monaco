import { describe, it, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";

import { RemoveUnusedSecretKeysStep } from "../../../src/infrastructure/migration/remove-unused-secret-keys-step.js";

describe("RemoveUnusedSecretKeysStep", () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => (key in store ? store[key] : null),
      removeItem: (key: string) => {
        delete store[key];
      },
    } as unknown as Storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("removes both keys when both are present and reports 2", async () => {
    vi.stubGlobal("window", {} as unknown as Window);
    store["byok:keys"] = "anything";
    store["hexagen:vault:encrypted-payload"] = "anything";
    store["hexagen-theme"] = "keep";

    const result = await new RemoveUnusedSecretKeysStep().migrate();

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.recordsMigrated, 2);
    assert.strictEqual(result.errors.length, 0);
    assert.ok(!("byok:keys" in store));
    assert.ok(!("hexagen:vault:encrypted-payload" in store));
    assert.strictEqual(store["hexagen-theme"], "keep");
  });

  it("removes one present key and reports 1", async () => {
    vi.stubGlobal("window", {} as unknown as Window);
    store["byok:keys"] = "x";

    const result = await new RemoveUnusedSecretKeysStep().migrate();

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.recordsMigrated, 1);
    assert.ok(!("byok:keys" in store));
    assert.ok(!("hexagen:vault:encrypted-payload" in store));
  });

  it("reports 0 and succeeds when neither key is present", async () => {
    vi.stubGlobal("window", {} as unknown as Window);

    const result = await new RemoveUnusedSecretKeysStep().migrate();

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.recordsMigrated, 0);
    assert.strictEqual(result.errors.length, 0);
  });

  it("leaves other keys untouched", async () => {
    vi.stubGlobal("window", {} as unknown as Window);
    store["hexagen:saved-projects"] = "keep-me";
    store["hexagen-theme"] = "also-keep";
    store["byok:keys"] = "remove";

    await new RemoveUnusedSecretKeysStep().migrate();

    assert.strictEqual(store["hexagen:saved-projects"], "keep-me");
    assert.strictEqual(store["hexagen-theme"], "also-keep");
    assert.ok(!("byok:keys" in store));
  });

  it("reports failure (no throw) when localStorage.removeItem throws", async () => {
    vi.stubGlobal("window", {} as unknown as Window);
    store["byok:keys"] = "x";
    store["hexagen:vault:encrypted-payload"] = "y";

    // Replace localStorage.removeItem with a thrower AFTER stubbing window,
    // so the global assignment below is the one in effect.
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => (key in store ? store[key] : null),
      removeItem: () => {
        throw new Error("boom");
      },
    } as unknown as Storage);

    const result = await new RemoveUnusedSecretKeysStep().migrate();

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.recordsMigrated, 0);
    assert.strictEqual(result.errors.length, 1);
    assert.ok(result.errors[0].includes("boom"));
  });

  it("is an SSR no-op when window is undefined", async () => {
    vi.unstubAllGlobals(); // no window

    const result = await new RemoveUnusedSecretKeysStep().migrate();

    assert.deepStrictEqual(result, {
      success: true,
      recordsMigrated: 0,
      errors: [],
    });
  });

  it("verify() is true only after both keys are removed", async () => {
    vi.stubGlobal("window", {} as unknown as Window);
    const step = new RemoveUnusedSecretKeysStep();

    store["byok:keys"] = "x";
    assert.strictEqual(await step.verify(), false);

    await step.migrate();
    assert.strictEqual(await step.verify(), true);
  });

  it("verify() is true on SSR", async () => {
    vi.unstubAllGlobals();
    const step = new RemoveUnusedSecretKeysStep();
    assert.strictEqual(await step.verify(), true);
  });
});
