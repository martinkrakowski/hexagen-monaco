import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { MODEL_PREFERENCE_KEYS } from "../../src/infrastructure/adapters/model-preference-keys.js";
import type { ModelPreferencesStorage } from "../../src/infrastructure/adapters/model-preference-storage.js";

/**
 * These functions are the local-AI preference adapter `apps/web` calls directly
 * (`useEngineLifecycle`, `useAutoInitLastModel`, `local-llm-context`). The
 * SUBJECT is the real adapter throughout — every assertion is on what it
 * returned, or on what a subsequent read of the store finds. Only the browser
 * store underneath it is supplied here, and it is supplied through the
 * contract the package itself publishes for that slot,
 * `ModelPreferencesStorage`.
 *
 * Why not jsdom's real `localStorage`, which would be more faithful still:
 * Node 24+ defines a global `localStorage` that throws unless the process was
 * started with `--localstorage-file`, and Vitest's jsdom environment skips
 * copying any window key that already exists on `globalThis`. So jsdom's store
 * survives on CI's Node 22.7 and is shadowed by the throwing global on a newer
 * local Node — a suite that passes in one place and fails in the other. An
 * explicit store is the honest way to keep this deterministic.
 *
 * The companion `.server.test.ts` covers the no-`window` half, which is the
 * branch this file cannot reach.
 */

/** A `ModelPreferencesStorage` that is ALSO index-enumerable, like a real
 * `Storage`. `resetLocalAIConfig` needs `length`/`key(i)` to sweep the
 * cache-metadata keys by prefix. */
class EnumerableStore implements ModelPreferencesStorage {
  private readonly entries = new Map<string, string>();

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, value);
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  get length(): number {
    return this.entries.size;
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }
}

/** The narrow contract only — no `length`, no `key`. This is what a caller
 * supplying a plain `ModelPreferencesStorage` looks like. */
class OpaqueStore implements ModelPreferencesStorage {
  private readonly entries = new Map<string, string>();

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, value);
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }
}

// The adapter's browser probe is a module-scope constant, so `window` has to
// exist BEFORE the module is evaluated — hence the stub-then-dynamic-import
// order rather than a static top-level import.
const fakeWindow: { localStorage: ModelPreferencesStorage } = {
  localStorage: new EnumerableStore(),
};
vi.stubGlobal("window", fakeWindow);

const {
  getAutoLoadEnabled,
  getHasEnabledLocalModels,
  getHasEnabledLocalModelsFlag,
  removeEnginePreferenceKeys,
  saveEngineInitSuccess,
  backfillHasEnabledForMigration,
  resetLocalAIConfig,
} =
  await import("../../src/infrastructure/adapters/model-preference-storage.js");

let storage: ModelPreferencesStorage;

beforeEach(() => {
  storage = new EnumerableStore();
  fakeWindow.localStorage = storage;
});

describe("saveEngineInitSuccess", () => {
  it("records auto-load, the model id, and the has-enabled flag in one write", () => {
    saveEngineInitSuccess("qwen3-4b");

    assert.equal(
      storage.getItem(MODEL_PREFERENCE_KEYS.AUTO_LOAD_ENABLED),
      "true",
    );
    assert.equal(
      storage.getItem(MODEL_PREFERENCE_KEYS.LAST_MODEL_ID),
      "qwen3-4b",
    );
    assert.equal(
      storage.getItem(MODEL_PREFERENCE_KEYS.HAS_ENABLED_LOCAL_MODELS),
      "true",
    );
  });

  it("overwrites the last model id on a later init", () => {
    saveEngineInitSuccess("qwen3-4b");
    saveEngineInitSuccess("qwen3-8b");

    assert.equal(
      storage.getItem(MODEL_PREFERENCE_KEYS.LAST_MODEL_ID),
      "qwen3-8b",
    );
  });
});

describe("removeEnginePreferenceKeys", () => {
  it("clears auto-load and the last model id but PRESERVES has-enabled", () => {
    saveEngineInitSuccess("qwen3-4b");

    removeEnginePreferenceKeys();

    assert.equal(
      storage.getItem(MODEL_PREFERENCE_KEYS.AUTO_LOAD_ENABLED),
      null,
    );
    assert.equal(storage.getItem(MODEL_PREFERENCE_KEYS.LAST_MODEL_ID), null);
    // "this user has run a local model before" outlives an engine reset — the
    // first-run onboarding must not reappear for a returning user.
    assert.equal(
      storage.getItem(MODEL_PREFERENCE_KEYS.HAS_ENABLED_LOCAL_MODELS),
      "true",
    );
    assert.equal(getHasEnabledLocalModels(), true);
    assert.equal(getAutoLoadEnabled(), false);
  });
});

describe("has-enabled: presence vs value", () => {
  it('getHasEnabledLocalModels is PRESENCE-based — an explicit "false" still counts', () => {
    storage.setItem(MODEL_PREFERENCE_KEYS.HAS_ENABLED_LOCAL_MODELS, "false");

    assert.equal(getHasEnabledLocalModels(), true);
  });

  it('getHasEnabledLocalModelsFlag is VALUE-based — an explicit "false" is false', () => {
    storage.setItem(MODEL_PREFERENCE_KEYS.HAS_ENABLED_LOCAL_MODELS, "false");

    assert.equal(getHasEnabledLocalModelsFlag(), false);
  });

  it("both are false when the key was never written", () => {
    assert.equal(getHasEnabledLocalModels(), false);
    assert.equal(getHasEnabledLocalModelsFlag(), false);
  });
});

describe("getAutoLoadEnabled", () => {
  it('is true only for the exact string "true"', () => {
    storage.setItem(MODEL_PREFERENCE_KEYS.AUTO_LOAD_ENABLED, "1");
    assert.equal(getAutoLoadEnabled(), false);

    storage.setItem(MODEL_PREFERENCE_KEYS.AUTO_LOAD_ENABLED, "true");
    assert.equal(getAutoLoadEnabled(), true);
  });
});

describe("backfillHasEnabledForMigration", () => {
  it("backfills has-enabled for a pre-flag user who had auto-load on", () => {
    storage.setItem(MODEL_PREFERENCE_KEYS.AUTO_LOAD_ENABLED, "true");

    backfillHasEnabledForMigration();

    assert.equal(
      storage.getItem(MODEL_PREFERENCE_KEYS.HAS_ENABLED_LOCAL_MODELS),
      "true",
    );
  });

  it("does not invent the flag when auto-load was never enabled", () => {
    backfillHasEnabledForMigration();

    assert.equal(
      storage.getItem(MODEL_PREFERENCE_KEYS.HAS_ENABLED_LOCAL_MODELS),
      null,
    );
  });

  it('does not overwrite an existing "false" — only an ABSENT key is backfilled', () => {
    storage.setItem(MODEL_PREFERENCE_KEYS.AUTO_LOAD_ENABLED, "true");
    storage.setItem(MODEL_PREFERENCE_KEYS.HAS_ENABLED_LOCAL_MODELS, "false");

    backfillHasEnabledForMigration();

    assert.equal(
      storage.getItem(MODEL_PREFERENCE_KEYS.HAS_ENABLED_LOCAL_MODELS),
      "false",
    );
  });
});

describe("resetLocalAIConfig", () => {
  it("reports exactly the keys it cleared, and skips keys that were absent", () => {
    storage.setItem(MODEL_PREFERENCE_KEYS.LAST_MODEL_ID, "qwen3-4b");

    const cleared = resetLocalAIConfig();

    assert.deepEqual(cleared, [MODEL_PREFERENCE_KEYS.LAST_MODEL_ID]);
    assert.equal(storage.getItem(MODEL_PREFERENCE_KEYS.LAST_MODEL_ID), null);
  });

  it("sweeps every cache-metadata key by prefix, not just the fixed key list", () => {
    saveEngineInitSuccess("qwen3-4b");
    storage.setItem("hexagen:model-verification-cache", "{}");
    const metaA = `${MODEL_PREFERENCE_KEYS.MODEL_CACHE_METADATA_PREFIX}qwen3-4b`;
    const metaB = `${MODEL_PREFERENCE_KEYS.MODEL_CACHE_METADATA_PREFIX}qwen3-8b`;
    storage.setItem(metaA, "{}");
    storage.setItem(metaB, "{}");

    const cleared = resetLocalAIConfig();

    assert.deepEqual(
      [...cleared].sort(),
      [
        MODEL_PREFERENCE_KEYS.AUTO_LOAD_ENABLED,
        MODEL_PREFERENCE_KEYS.HAS_ENABLED_LOCAL_MODELS,
        MODEL_PREFERENCE_KEYS.LAST_MODEL_ID,
        metaA,
        metaB,
        "hexagen:model-verification-cache",
      ].sort(),
    );
    assert.equal(storage.getItem(metaA), null);
    assert.equal(storage.getItem(metaB), null);
  });

  it("clears only the fixed keys when the store is not index-enumerable", () => {
    const opaque = new OpaqueStore();
    fakeWindow.localStorage = opaque;
    const meta = `${MODEL_PREFERENCE_KEYS.MODEL_CACHE_METADATA_PREFIX}qwen3-4b`;
    opaque.setItem(MODEL_PREFERENCE_KEYS.LAST_MODEL_ID, "qwen3-4b");
    opaque.setItem(meta, "{}");

    const cleared = resetLocalAIConfig();

    assert.deepEqual(cleared, [MODEL_PREFERENCE_KEYS.LAST_MODEL_ID]);
    // Honest about the limit: a prefix sweep needs `length`/`key(i)`, which the
    // narrow contract does not promise, so the cache metadata survives.
    assert.equal(opaque.getItem(meta), "{}");
  });

  it("leaves unrelated hexagen preferences alone — the reset is scoped to local AI", () => {
    storage.setItem(MODEL_PREFERENCE_KEYS.CLOUD_PROVIDER, "openrouter");
    storage.setItem(MODEL_PREFERENCE_KEYS.SKIP_AI_SETUP, "true");
    saveEngineInitSuccess("qwen3-4b");

    const cleared = resetLocalAIConfig();

    assert.equal(cleared.includes(MODEL_PREFERENCE_KEYS.CLOUD_PROVIDER), false);
    assert.equal(
      storage.getItem(MODEL_PREFERENCE_KEYS.CLOUD_PROVIDER),
      "openrouter",
    );
    assert.equal(storage.getItem(MODEL_PREFERENCE_KEYS.SKIP_AI_SETUP), "true");
  });

  it("returns an empty list when there is nothing to clear", () => {
    assert.deepEqual(resetLocalAIConfig(), []);
  });
});
